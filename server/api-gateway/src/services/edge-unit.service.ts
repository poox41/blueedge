import {
  blueedgeNamespace,
  blueedgeResourceLabel,
  create,
  edgeUnitResourceValue,
  ensureNamespace,
  remove,
  update,
} from "../repositories/blueedge-configmap.repository.js";
import type { EdgeUnitAuxSources } from "../types/edge-unit.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  annotationsOf,
  dataOf,
  explicitNodeNamesOf,
  isNodeReady,
  labelsOf,
  metadataOf,
  nodeGroupSelectorOf,
  nodeMatchesSelector,
  nodeNameOf,
} from "../utils/kubernetes.js";
import {
  isValidKubernetesName,
  readStringField,
} from "../utils/validation.js";
import {
  collectEdgeUnitAuxSources,
  collectEdgeUnitSources,
  collectNodeGroupDetails,
  edgeUnitConfigMapMatches,
  edgeUnitConfigMapName,
  edgeUnitConfigMapResourceName,
  edgeUnitNameLabel,
  getEdgeUnitConfigMaps,
  getNodeGroupByName,
  isValidEdgeUnitConfigMap,
} from "./edge-unit-source.service.js";

const edgeUnitAccessTypes = new Set(["external", "dedicated", "unknown"]);
const edgeUnitComponentStates = new Set(["installed", "notInstalled", "unknown"]);

function normalizeEdgeUnitAccessType(value: string | undefined): string {
  if (!value) return "unknown";
  return edgeUnitAccessTypes.has(value) ? value : "";
}

function normalizeEdgeUnitComponentState(value: string | undefined): string {
  if (!value) return "unknown";
  return edgeUnitComponentStates.has(value) ? value : "";
}

function buildEdgeUnitConfigMapData(body: any, existingData?: Record<string, string>) {
  const name = readStringField(body, "name") || existingData?.name || "";
  const nodeGroupRef = readStringField(body, "nodeGroupRef") || existingData?.nodeGroupRef || "";
  const accessType = normalizeEdgeUnitAccessType(readStringField(body, "accessType") ?? existingData?.accessType);
  const insightStatus = normalizeEdgeUnitComponentState(readStringField(body, "insightStatus") ?? existingData?.insightStatus);
  const monitorStatus = normalizeEdgeUnitComponentState(readStringField(body, "monitorStatus") ?? existingData?.monitorStatus);

  if (!accessType) throw new Error("accessType must be one of external, dedicated, unknown");
  if (!insightStatus) throw new Error("insightStatus must be one of installed, notInstalled, unknown");
  if (!monitorStatus) throw new Error("monitorStatus must be one of installed, notInstalled, unknown");

  return {
    name,
    nodeGroupRef,
    clusterName: readStringField(body, "clusterName") ?? existingData?.clusterName ?? "",
    accessType,
    kubeEdgeVersion: readStringField(body, "kubeEdgeVersion") ?? existingData?.kubeEdgeVersion ?? "",
    insightStatus,
    monitorStatus,
    description: readStringField(body, "description") ?? existingData?.description ?? "",
  };
}

function buildEdgeUnitConfigMap(body: any, existing?: any) {
  const existingData = dataOf(existing);
  const data = buildEdgeUnitConfigMapData(body, existingData);
  const existingMetadata = metadataOf(existing);

  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      ...(existingMetadata.resourceVersion ? { resourceVersion: existingMetadata.resourceVersion } : {}),
      name: existingMetadata.name || edgeUnitConfigMapResourceName(data.name),
      namespace: blueedgeNamespace(),
      labels: {
        ...(existingMetadata.labels || {}),
        [blueedgeResourceLabel]: edgeUnitResourceValue,
        [edgeUnitNameLabel]: data.name,
      },
    },
    data,
  };
}

export function nodesForNodeGroup(nodeGroup: any, nodes: any[]) {
  const explicitNodeNames = explicitNodeNamesOf(nodeGroup);
  if (explicitNodeNames.length > 0) {
    const names = new Set(explicitNodeNames);
    return nodes.filter((node) => names.has(nodeNameOf(node)));
  }

  const selector = nodeGroupSelectorOf(nodeGroup);
  if (Object.keys(selector).length > 0) {
    return nodes.filter((node) => nodeMatchesSelector(node, selector));
  }

  return [];
}

export function annotationValue(nodeGroup: any, keys: string[], fallback = "unknown"): string {
  const annotations = annotationsOf(nodeGroup);
  const labels = labelsOf(nodeGroup);
  for (const key of keys) {
    const value = annotations[key] || labels[key];
    if (value) return value;
  }
  return fallback;
}

function normalizeAccessType(value: string): "external" | "dedicated" | "unknown" {
  if (["external", "外接"].includes(value)) return "external";
  if (["dedicated", "exclusive", "private", "专有"].includes(value)) return "dedicated";
  return "unknown";
}

function normalizeComponentState(value: string): "installed" | "notInstalled" | "unknown" {
  if (["installed", "true", "enabled", "已安装", "已启用"].includes(value)) return "installed";
  if (["notInstalled", "false", "disabled", "未安装", "未启用"].includes(value)) return "notInstalled";
  return "unknown";
}

export function deploymentTargetsEdgeUnit(deployment: any, edgeUnitName: string, nodeGroupRef: string): boolean {
  const candidates = [
    labelsOf(deployment),
    annotationsOf(deployment),
    deployment?.spec?.template?.metadata?.labels || {},
    deployment?.spec?.template?.metadata?.annotations || {},
  ];
  return candidates.some((record) => {
    if (!record || typeof record !== "object") return false;
    return [
      record["blueedge.io/nodegroup"],
      record["blueedge.io/node-group"],
      record["blueedge.io/edge-unit"],
      record["kubeedge.io/nodegroup"],
      record.nodeGroup,
      record.edgeUnit,
    ].some((value) => {
      const normalized = String(value || "");
      return normalized === edgeUnitName || normalized === nodeGroupRef;
    });
  });
}

export function isDeploymentHealthy(deployment: any): boolean {
  const replicas = Number(deployment?.spec?.replicas ?? deployment?.replicas ?? 1);
  const available = Number(deployment?.status?.availableReplicas ?? deployment?.availableReplicas ?? 0);
  return replicas > 0 && available >= replicas;
}

export function edgeApplicationTargetsNodeGroup(app: any, nodeGroupName: string): boolean {
  const targetNodeGroups = app?.spec?.workloadScope?.targetNodeGroups;
  if (!Array.isArray(targetNodeGroups)) return false;
  return targetNodeGroups.some((group: any) => String(typeof group === "string" ? group : group?.name || "") === nodeGroupName);
}

export function isEdgeApplicationHealthy(app: any): boolean {
  const value = String(app?.status?.phase || app?.status?.status || app?.status?.state || "").toLowerCase();
  return ["ready", "running", "success", "succeeded", "available"].includes(value);
}

function buildEdgeUnitRuntime(nodeGroup: any | null, aux: EdgeUnitAuxSources, edgeUnitName: string, nodeGroupRef: string) {
  if (!nodeGroup) {
    return {
      status: "unknown",
      nodes: { ready: 0, total: 0 },
      workloads: { healthy: 0, total: 0 },
      applications: { healthy: 0, total: 0 },
    };
  }

  const explicitNodeNames = explicitNodeNamesOf(nodeGroup);
  const matchedNodes = nodesForNodeGroup(nodeGroup, aux.nodes);
  const nodeTotal = explicitNodeNames.length > 0 ? explicitNodeNames.length : matchedNodes.length;
  const nodeReady = matchedNodes.filter(isNodeReady).length;
  const status = nodeTotal === 0 ? "unknown" : nodeReady === nodeTotal ? "running" : "abnormal";
  const deployments = aux.deployments.filter((item) => deploymentTargetsEdgeUnit(item, edgeUnitName, nodeGroupRef));
  const edgeApplications = aux.edgeApplications.filter((item) => edgeApplicationTargetsNodeGroup(item, nodeGroupRef));

  return {
    status,
    nodes: {
      ready: nodeReady,
      total: nodeTotal,
    },
    workloads: {
      healthy: deployments.filter(isDeploymentHealthy).length,
      total: deployments.length,
    },
    applications: {
      healthy: edgeApplications.filter(isEdgeApplicationHealthy).length,
      total: edgeApplications.length,
    },
  };
}

function buildNodeGroupEdgeUnitView(nodeGroup: any, aux: EdgeUnitAuxSources) {
  const name = String(metadataOf(nodeGroup).name || nodeGroup?.name || "");
  const runtime = buildEdgeUnitRuntime(nodeGroup, aux, name, name);

  return {
    name,
    status: runtime.status,
    accessType: normalizeAccessType(annotationValue(nodeGroup, ["blueedge.io/access-type"])),
    clusterName: annotationValue(nodeGroup, ["blueedge.io/cluster-name", "blueedge.io/cluster"]),
    kubeEdgeVersion: annotationValue(nodeGroup, ["blueedge.io/kubeedge-version", "kubeedge.io/version"]),
    createdAt: metadataOf(nodeGroup).creationTimestamp || nodeGroup?.creationTimestamp || "",
    nodes: runtime.nodes,
    workloads: runtime.workloads,
    applications: runtime.applications,
    components: {
      insight: normalizeComponentState(annotationValue(nodeGroup, ["blueedge.io/insight", "blueedge.io/component-insight"])),
      monitor: normalizeComponentState(annotationValue(nodeGroup, ["blueedge.io/monitor", "blueedge.io/component-monitor"])),
    },
    description: annotationValue(nodeGroup, ["blueedge.io/description", "description"], ""),
    rawRef: {
      kind: "NodeGroup",
      name,
    },
  };
}

function buildConfigMapEdgeUnitView(configMap: any, nodeGroup: any | null, aux: EdgeUnitAuxSources) {
  const metadata = metadataOf(configMap);
  const data = dataOf(configMap);
  const name = data.name;
  const nodeGroupRef = data.nodeGroupRef;
  const runtime = buildEdgeUnitRuntime(nodeGroup, aux, name, nodeGroupRef);

  return {
    name,
    status: runtime.status,
    accessType: normalizeAccessType(data.accessType || "unknown"),
    clusterName: data.clusterName || "unknown",
    kubeEdgeVersion: data.kubeEdgeVersion || "unknown",
    createdAt: metadata.creationTimestamp || "",
    nodes: runtime.nodes,
    workloads: runtime.workloads,
    applications: runtime.applications,
    components: {
      insight: normalizeComponentState(data.insightStatus || "unknown"),
      monitor: normalizeComponentState(data.monitorStatus || "unknown"),
    },
    description: data.description || "",
    rawRef: {
      kind: "EdgeUnitConfigMap",
      name: metadata.name || "",
      nodeGroupRef,
    },
  };
}

async function findEdgeUnitConfigMap(name: string, warnings: EdgeUnitWarning[]): Promise<any | null> {
  const configMaps = await getEdgeUnitConfigMaps(warnings);
  return configMaps.find((configMap) => edgeUnitConfigMapMatches(configMap, name)) || null;
}

async function buildConfigMapEdgeUnitResponse(configMap: any, warnings: EdgeUnitWarning[]) {
  const data = dataOf(configMap);
  const edgeUnitName = data.name || edgeUnitConfigMapName(configMap);
  const { nodeGroupByName, aux } = await collectEdgeUnitSources(warnings);
  const nodeGroup = data.nodeGroupRef ? nodeGroupByName.get(data.nodeGroupRef) || null : null;

  if (!nodeGroup) {
    warnings.push({
      source: "edgeunit.nodeGroupRef",
      message: `EdgeUnit ${edgeUnitName} references missing NodeGroup ${data.nodeGroupRef || "-"}`,
    });
  }

  return {
    item: buildConfigMapEdgeUnitView(configMap, nodeGroup, aux),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function validationError(error: unknown) {
  return { status: 400, body: { message: error instanceof Error ? error.message : "Invalid EdgeUnit payload" } };
}

export async function listEdgeUnits() {
  const warnings: EdgeUnitWarning[] = [];
  const edgeUnitConfigMaps = await getEdgeUnitConfigMaps(warnings);
  const validEdgeUnitConfigMaps = edgeUnitConfigMaps.filter((configMap) => isValidEdgeUnitConfigMap(configMap, warnings));

  if (validEdgeUnitConfigMaps.length > 0) {
    const [{ nodeGroupByName }, aux] = await Promise.all([
      collectNodeGroupDetails(warnings),
      collectEdgeUnitAuxSources(warnings),
    ]);
    const items = validEdgeUnitConfigMaps.map((configMap) => {
      const data = dataOf(configMap);
      const nodeGroup = nodeGroupByName.get(data.nodeGroupRef) || null;
      if (!nodeGroup) {
        warnings.push({
          source: "edgeunit.nodeGroupRef",
          message: `EdgeUnit ${data.name} references missing NodeGroup ${data.nodeGroupRef}`,
        });
      }
      return buildConfigMapEdgeUnitView(configMap, nodeGroup, aux);
    });
    return { items, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  const [{ nodeGroups, nodeGroupError }, aux] = await Promise.all([
    collectNodeGroupDetails(warnings),
    collectEdgeUnitAuxSources(warnings),
  ]);
  if (nodeGroupError) throw nodeGroupError;

  return {
    items: nodeGroups.map((nodeGroup) => buildNodeGroupEdgeUnitView(nodeGroup, aux)),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function createEdgeUnit(body: any) {
  const warnings: EdgeUnitWarning[] = [];
  let configMap;
  try {
    configMap = buildEdgeUnitConfigMap(body);
  } catch (error) {
    return validationError(error);
  }

  const data = dataOf(configMap);
  if (!data.name || !data.nodeGroupRef) {
    return { status: 400, body: { message: "name and nodeGroupRef are required" } };
  }
  if (!isValidKubernetesName(data.name)) {
    return { status: 400, body: { message: "name must be a valid Kubernetes resource name" } };
  }

  const nodeGroup = await getNodeGroupByName(data.nodeGroupRef);
  if (!nodeGroup) {
    return { status: 400, body: { message: `NodeGroup ${data.nodeGroupRef} does not exist` } };
  }

  const duplicated = await findEdgeUnitConfigMap(data.name, warnings);
  if (duplicated) {
    return { status: 409, body: { message: `EdgeUnit ${data.name} already exists`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  await ensureNamespace();
  const created = await create(configMap);
  return { status: 201, body: await buildConfigMapEdgeUnitResponse(created, warnings) };
}

export async function getEdgeUnit(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const { edgeUnitConfigMaps, nodeGroups, nodeGroupError, nodeGroupByName, aux } = await collectEdgeUnitSources(warnings);
  const matchedConfigMap = edgeUnitConfigMaps.find((configMap) => edgeUnitConfigMapMatches(configMap, name));

  if (matchedConfigMap) {
    const data = dataOf(matchedConfigMap);
    const edgeUnitName = data.name || edgeUnitConfigMapName(matchedConfigMap);
    if (!data.name || !data.nodeGroupRef) {
      warnings.push({
        source: "edgeunit.configmap",
        message: `Invalid EdgeUnit ConfigMap ${metadataOf(matchedConfigMap).namespace || "blueedge-system"}/${metadataOf(matchedConfigMap).name || "-"}: missing data.name or data.nodeGroupRef`,
      });
    } else {
      const nodeGroup = nodeGroupByName.get(data.nodeGroupRef) || null;
      if (!nodeGroup) {
        warnings.push({
          source: "edgeunit.nodeGroupRef",
          message: `EdgeUnit ${edgeUnitName} references missing NodeGroup ${data.nodeGroupRef}`,
        });
      }
      return {
        status: 200,
        body: {
          item: buildConfigMapEdgeUnitView(matchedConfigMap, nodeGroup, aux),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    }
  }

  if (nodeGroupError) throw nodeGroupError;

  const nodeGroup = nodeGroups.find((item) => String(metadataOf(item).name || item?.name || "") === name);
  if (!nodeGroup) {
    return { status: 404, body: { message: `EdgeUnit ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  return {
    status: 200,
    body: {
      item: buildNodeGroupEdgeUnitView(nodeGroup, aux),
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

export async function updateEdgeUnit(name: string, body: any) {
  const warnings: EdgeUnitWarning[] = [];

  if (Object.prototype.hasOwnProperty.call(body || {}, "name") || Object.prototype.hasOwnProperty.call(body || {}, "nodeGroupRef")) {
    return { status: 400, body: { message: "name and nodeGroupRef are immutable" } };
  }

  const existing = await findEdgeUnitConfigMap(name, warnings);
  if (!existing) {
    const nodeGroup = await getNodeGroupByName(name);
    return {
      status: nodeGroup ? 409 : 404,
      body: {
        message: nodeGroup ? `EdgeUnit ${name} is generated from NodeGroup fallback and has no editable metadata ConfigMap` : `EdgeUnit ${name} not found`,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  }

  if (!isValidEdgeUnitConfigMap(existing, warnings)) {
    return { status: 400, body: { message: `EdgeUnit ${name} metadata ConfigMap is invalid`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  let configMap;
  try {
    configMap = buildEdgeUnitConfigMap(body, existing);
  } catch (error) {
    return validationError(error);
  }

  const updated = await update(metadataOf(existing).name, configMap);
  return { status: 200, body: await buildConfigMapEdgeUnitResponse(updated, warnings) };
}

export async function deleteEdgeUnit(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const existing = await findEdgeUnitConfigMap(name, warnings);

  if (!existing) {
    const nodeGroup = await getNodeGroupByName(name);
    return {
      status: nodeGroup ? 409 : 404,
      body: {
        message: nodeGroup ? `EdgeUnit ${name} is generated from NodeGroup fallback and has no metadata ConfigMap to delete` : `EdgeUnit ${name} not found`,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  }

  await remove(metadataOf(existing).name);

  return {
    status: 200,
    body: {
      warnings: [
        ...warnings,
        {
          source: "edgeunit.delete",
          message: `EdgeUnit ${name} metadata deleted. Underlying NodeGroup is retained and may appear via fallback.`,
        },
      ],
    },
  };
}
