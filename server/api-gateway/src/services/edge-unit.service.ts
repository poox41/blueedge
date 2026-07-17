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
  podMatchesSelector,
  podNamespace,
  selectorOfWorkload,
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
const edgeUnitNodeScales = new Set(["小型", "中型", "大型"]);
const edgeUnitProtocols = new Set(["WebSocket", "QUIC"]);
const edgeUnitUninstallPolicies = new Set(["保留相关命名空间", "删除相关命名空间"]);
const edgeUnitPortKeys = ["websocket", "quic", "https", "cloudStream", "tunnel"] as const;

type EdgeUnitPorts = Record<(typeof edgeUnitPortKeys)[number], string>;

function normalizeEdgeUnitAccessType(value: string | undefined): string {
  if (!value) return "unknown";
  return edgeUnitAccessTypes.has(value) ? value : "";
}

function normalizeEdgeUnitComponentState(value: string | undefined): string {
  if (!value) return "unknown";
  return edgeUnitComponentStates.has(value) ? value : "";
}

function hasOwnField(body: any, key: string): boolean {
  return Boolean(body && typeof body === "object" && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, key));
}

function readBooleanConfig(body: any, key: string, existingValue?: string): string {
  if (!hasOwnField(body, key)) return existingValue || "";
  const value = body[key];
  if (value === true || value === "true") return "true";
  if (value === false || value === "false") return "false";
  throw new Error(`${key} must be a boolean`);
}

function readEnumConfig(body: any, key: string, allowed: Set<string>, existingValue?: string): string {
  if (!hasOwnField(body, key)) return existingValue || "";
  const value = readStringField(body, key) || "";
  if (!allowed.has(value)) throw new Error(`${key} has an unsupported value`);
  return value;
}

function readStringArrayConfig(body: any, key: string, existingValue?: string, allowed?: Set<string>): string {
  if (!hasOwnField(body, key)) return existingValue || "";
  if (!Array.isArray(body[key])) throw new Error(`${key} must be an array`);
  const values = Array.from(new Set(body[key].map((item: any) => String(item).trim()).filter(Boolean)));
  if (allowed && values.some((item) => !allowed.has(item))) throw new Error(`${key} contains an unsupported value`);
  return JSON.stringify(values);
}

function readPortsConfig(body: any, existingValue?: string): string {
  if (!hasOwnField(body, "ports")) return existingValue || "";
  const source = body.ports;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("ports must be an object");
  const ports = Object.fromEntries(edgeUnitPortKeys.map((key) => {
    const value = String(source[key] ?? "").trim();
    const port = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`ports.${key} must be an integer between 0 and 65535`);
    }
    return [key, value];
  })) as EdgeUnitPorts;
  return JSON.stringify(ports);
}

function parseJsonArray(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : undefined;
  } catch {
    return undefined;
  }
}

function parsePorts(value: string | undefined): EdgeUnitPorts | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    if (edgeUnitPortKeys.some((key) => typeof parsed[key] !== "string")) return undefined;
    return Object.fromEntries(edgeUnitPortKeys.map((key) => [key, parsed[key]])) as EdgeUnitPorts;
  } catch {
    return undefined;
  }
}

export function buildEdgeUnitConfiguration(data: Record<string, string>) {
  return {
    ...(edgeUnitNodeScales.has(data.nodeScale) ? { nodeScale: data.nodeScale } : {}),
    ...(data.mqttEnabled === "true" || data.mqttEnabled === "false" ? { mqttEnabled: data.mqttEnabled === "true" } : {}),
    ...(parseJsonArray(data.protocols) ? { protocols: parseJsonArray(data.protocols) } : {}),
    ...(parseJsonArray(data.accessAddresses) ? { accessAddresses: parseJsonArray(data.accessAddresses) } : {}),
    ...(parsePorts(data.ports) ? { ports: parsePorts(data.ports) } : {}),
    ...(edgeUnitUninstallPolicies.has(data.uninstallPolicy) ? { uninstallPolicy: data.uninstallPolicy } : {}),
  };
}

export function buildEdgeUnitConfigMapData(body: any, existingData?: Record<string, string>) {
  const name = readStringField(body, "name") || existingData?.name || "";
  const requestedNodeGroupRef = readStringField(body, "nodeGroupRef");
  const nodeGroupRef = requestedNodeGroupRef !== undefined ? requestedNodeGroupRef : existingData?.nodeGroupRef || "";
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
    nodeScale: readEnumConfig(body, "nodeScale", edgeUnitNodeScales, existingData?.nodeScale),
    mqttEnabled: readBooleanConfig(body, "mqttEnabled", existingData?.mqttEnabled),
    protocols: readStringArrayConfig(body, "protocols", existingData?.protocols, edgeUnitProtocols),
    accessAddresses: readStringArrayConfig(body, "accessAddresses", existingData?.accessAddresses),
    ports: readPortsConfig(body, existingData?.ports),
    uninstallPolicy: readEnumConfig(body, "uninstallPolicy", edgeUnitUninstallPolicies, existingData?.uninstallPolicy),
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
  return deploymentOwnershipValues(deployment).some((normalized) =>
    normalized === edgeUnitName || (Boolean(nodeGroupRef) && normalized === nodeGroupRef),
  );
}

function deploymentOwnershipValues(deployment: any): string[] {
  const candidates = [
    labelsOf(deployment),
    annotationsOf(deployment),
    deployment?.spec?.template?.metadata?.labels || {},
    deployment?.spec?.template?.metadata?.annotations || {},
  ];
  return candidates.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    return [
      record["blueedge.io/nodegroup"],
      record["blueedge.io/node-group"],
      record["blueedge.io/edge-unit"],
      record["kubeedge.io/nodegroup"],
      record.nodeGroup,
      record.edgeUnit,
    ].map((value) => String(value || "")).filter(Boolean);
  });
}

export function deploymentBelongsToEdgeUnit(deployment: any, edgeUnitName: string, nodeGroupRef: string): boolean {
  const ownershipValues = deploymentOwnershipValues(deployment);
  if (ownershipValues.length === 0) return false;
  return deploymentTargetsEdgeUnit(deployment, edgeUnitName, nodeGroupRef);
}

export function deploymentRunsOnNodes(deployment: any, pods: any[], nodeNames: Set<string>): boolean {
  return deploymentPodsOnNodes(deployment, pods, nodeNames).length > 0;
}

export function deploymentPodsOnNodes(deployment: any, pods: any[], nodeNames: Set<string>): any[] {
  if (nodeNames.size === 0) return [];
  const selector = selectorOfWorkload(deployment);
  if (Object.keys(selector).length === 0) return [];
  const metadata = metadataOf(deployment);
  const namespace = String(metadata.namespace || deployment?.namespace || "default");
  return pods.filter((pod) =>
    !metadataOf(pod).deletionTimestamp &&
    nodeNames.has(String(pod?.spec?.nodeName || "")) &&
    podNamespace(pod) === namespace &&
    podMatchesSelector(pod, selector),
  );
}

export function isPodReady(pod: any): boolean {
  if (metadataOf(pod).deletionTimestamp || String(pod?.status?.phase || "") !== "Running") return false;
  const conditions = Array.isArray(pod?.status?.conditions) ? pod.status.conditions : [];
  return conditions.some((condition: any) => condition?.type === "Ready" && condition?.status === "True");
}

export function isDeploymentHealthyOnNodes(deployment: any, pods: any[], nodeNames: Set<string>): boolean {
  return deploymentPodsOnNodes(deployment, pods, nodeNames).some(isPodReady);
}

function resourceDirectlyTargetsEdgeUnit(resource: any, edgeUnitName: string): boolean {
  const candidates = [
    labelsOf(resource),
    annotationsOf(resource),
  ];
  return candidates.some((record) => [
    record["blueedge.io/edge-unit"],
    record.edgeUnit,
  ].some((value) => String(value || "") === edgeUnitName));
}

export function nodeTargetsEdgeUnit(node: any, edgeUnitName: string): boolean {
  return resourceDirectlyTargetsEdgeUnit(node, edgeUnitName);
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

export function edgeApplicationTargetsEdgeUnit(app: any, edgeUnitName: string, nodeGroupName: string): boolean {
  const workloadTemplate = app?.spec?.workloadTemplate;
  const manifests = Array.isArray(workloadTemplate?.manifests) ? workloadTemplate.manifests : [];
  return resourceDirectlyTargetsEdgeUnit(app, edgeUnitName) ||
    resourceDirectlyTargetsEdgeUnit(workloadTemplate, edgeUnitName) ||
    manifests.some((manifest: any) => resourceDirectlyTargetsEdgeUnit(manifest, edgeUnitName)) ||
    (Boolean(nodeGroupName) && edgeApplicationTargetsNodeGroup(app, nodeGroupName));
}

export function edgeApplicationBelongsToEdgeUnit(
  app: any,
  edgeUnitName: string,
  nodeGroupName: string,
  _knownNodeGroupNames: Set<string>,
): boolean {
  if (!nodeGroupName) return false;
  return edgeApplicationTargetsEdgeUnit(app, edgeUnitName, nodeGroupName);
}

export function isEdgeApplicationHealthy(app: any): boolean {
  const value = String(app?.status?.phase || app?.status?.status || app?.status?.state || "").toLowerCase();
  return ["ready", "running", "success", "succeeded", "available"].includes(value);
}

function uniqueResources(items: any[]): any[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const metadata = metadataOf(item);
    const key = `${metadata.namespace || item?.namespace || ""}/${metadata.name || item?.name || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildEdgeUnitResourceSet(
  nodeGroup: any | null,
  aux: EdgeUnitAuxSources,
  edgeUnitName: string,
  nodeGroupRef: string,
  knownNodeGroupNames: Set<string> = new Set(),
) {
  if (!nodeGroupRef || !nodeGroup) {
    return { nodes: [], deployments: [], edgeApplications: [] };
  }

  const nodeGroupNodes = nodeGroup ? nodesForNodeGroup(nodeGroup, aux.nodes) : [];
  const nodes = uniqueResources(nodeGroupNodes);
  const nodeNames = new Set(nodes.map(nodeNameOf).filter(Boolean));
  const deployments = aux.deployments.filter((item) =>
    deploymentBelongsToEdgeUnit(item, edgeUnitName, nodeGroupRef) ||
    deploymentRunsOnNodes(item, aux.pods, nodeNames),
  );
  const edgeApplications = aux.edgeApplications.filter((item) =>
    edgeApplicationBelongsToEdgeUnit(item, edgeUnitName, nodeGroupRef, knownNodeGroupNames),
  );
  return { nodes, deployments, edgeApplications };
}

export function buildEdgeUnitRuntime(
  nodeGroup: any | null,
  aux: EdgeUnitAuxSources,
  edgeUnitName: string,
  nodeGroupRef: string,
  knownNodeGroupNames: Set<string> = new Set(),
) {
  const resources = buildEdgeUnitResourceSet(nodeGroup, aux, edgeUnitName, nodeGroupRef, knownNodeGroupNames);
  const explicitNodeNames = nodeGroup ? explicitNodeNamesOf(nodeGroup) : [];
  const nodeTotal = explicitNodeNames.length > 0 ? explicitNodeNames.length : resources.nodes.length;
  const nodeReady = resources.nodes.filter(isNodeReady).length;
  const nodeNames = new Set(resources.nodes.map(nodeNameOf).filter(Boolean));
  const status = nodeTotal === 0 ? "unknown" : nodeReady === nodeTotal ? "running" : "abnormal";

  return {
    status,
    nodes: {
      ready: nodeReady,
      total: nodeTotal,
    },
    workloads: {
      healthy: resources.deployments.filter((deployment) => isDeploymentHealthyOnNodes(deployment, aux.pods, nodeNames)).length,
      total: resources.deployments.length,
    },
    applications: {
      healthy: resources.edgeApplications.filter(isEdgeApplicationHealthy).length,
      total: resources.edgeApplications.length,
    },
  };
}

function resourceRef(item: any) {
  const metadata = metadataOf(item);
  return {
    namespace: String(metadata.namespace || item?.namespace || "default"),
    name: String(metadata.name || item?.name || ""),
  };
}

function buildNodeGroupEdgeUnitView(nodeGroup: any, aux: EdgeUnitAuxSources, knownNodeGroupNames: Set<string> = new Set()) {
  const name = String(metadataOf(nodeGroup).name || nodeGroup?.name || "");
  const runtime = buildEdgeUnitRuntime(nodeGroup, aux, name, name, knownNodeGroupNames);

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

function buildConfigMapEdgeUnitView(configMap: any, nodeGroup: any | null, aux: EdgeUnitAuxSources, knownNodeGroupNames: Set<string> = new Set()) {
  const metadata = metadataOf(configMap);
  const data = dataOf(configMap);
  const name = data.name;
  const nodeGroupRef = data.nodeGroupRef;
  const runtime = buildEdgeUnitRuntime(nodeGroup, aux, name, nodeGroupRef, knownNodeGroupNames);

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
    ...buildEdgeUnitConfiguration(data),
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

  if (data.nodeGroupRef && !nodeGroup) {
    warnings.push({
      source: "edgeunit.nodeGroupRef",
      message: `EdgeUnit ${edgeUnitName} references missing NodeGroup ${data.nodeGroupRef || "-"}`,
    });
  }

  return {
    item: buildConfigMapEdgeUnitView(configMap, nodeGroup, aux, new Set(nodeGroupByName.keys())),
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
      const nodeGroup = data.nodeGroupRef ? nodeGroupByName.get(data.nodeGroupRef) || null : null;
      if (data.nodeGroupRef && !nodeGroup) {
        warnings.push({
          source: "edgeunit.nodeGroupRef",
          message: `EdgeUnit ${data.name} references missing NodeGroup ${data.nodeGroupRef}`,
        });
      }
      return buildConfigMapEdgeUnitView(configMap, nodeGroup, aux, new Set(nodeGroupByName.keys()));
    });
    return { items, ...(warnings.length > 0 ? { warnings } : {}) };
  }

  const [{ nodeGroups, nodeGroupError }, aux] = await Promise.all([
    collectNodeGroupDetails(warnings),
    collectEdgeUnitAuxSources(warnings),
  ]);
  if (nodeGroupError) throw nodeGroupError;

  return {
    items: nodeGroups.map((nodeGroup) => buildNodeGroupEdgeUnitView(nodeGroup, aux, new Set(nodeGroups.map((item) => String(metadataOf(item).name || item?.name || ""))))),
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
  if (!data.name) {
    return { status: 400, body: { message: "name is required" } };
  }
  if (!isValidKubernetesName(data.name)) {
    return { status: 400, body: { message: "name must be a valid Kubernetes resource name" } };
  }

  if (data.nodeGroupRef) {
    const nodeGroup = await getNodeGroupByName(data.nodeGroupRef);
    if (!nodeGroup) {
      return { status: 400, body: { message: `NodeGroup ${data.nodeGroupRef} does not exist` } };
    }
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
    if (!data.name) {
      warnings.push({
        source: "edgeunit.configmap",
        message: `Invalid EdgeUnit ConfigMap ${metadataOf(matchedConfigMap).namespace || "blueedge-system"}/${metadataOf(matchedConfigMap).name || "-"}: missing data.name`,
      });
    } else {
      const nodeGroup = data.nodeGroupRef ? nodeGroupByName.get(data.nodeGroupRef) || null : null;
      if (data.nodeGroupRef && !nodeGroup) {
        warnings.push({
          source: "edgeunit.nodeGroupRef",
          message: `EdgeUnit ${edgeUnitName} references missing NodeGroup ${data.nodeGroupRef}`,
        });
      }
      return {
        status: 200,
        body: {
          item: buildConfigMapEdgeUnitView(matchedConfigMap, nodeGroup, aux, new Set(nodeGroupByName.keys())),
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
      item: buildNodeGroupEdgeUnitView(nodeGroup, aux, new Set(nodeGroupByName.keys())),
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

export async function getEdgeUnitResources(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const { edgeUnitConfigMaps, nodeGroups, nodeGroupError, nodeGroupByName, aux } = await collectEdgeUnitSources(warnings);
  const matchedConfigMap = edgeUnitConfigMaps.find((configMap) => edgeUnitConfigMapMatches(configMap, name));

  let nodeGroup: any | null = null;
  let nodeGroupRef = "";
  let item: any | null = null;

  if (matchedConfigMap && isValidEdgeUnitConfigMap(matchedConfigMap, warnings)) {
    const data = dataOf(matchedConfigMap);
    nodeGroupRef = data.nodeGroupRef || "";
    nodeGroup = nodeGroupRef ? nodeGroupByName.get(nodeGroupRef) || null : null;
    if (nodeGroupRef && !nodeGroup) {
      warnings.push({ source: "edgeunit.nodeGroupRef", message: `EdgeUnit ${name} references missing NodeGroup ${nodeGroupRef}` });
    }
    item = buildConfigMapEdgeUnitView(matchedConfigMap, nodeGroup, aux, new Set(nodeGroupByName.keys()));
  } else {
    if (nodeGroupError) throw nodeGroupError;
    nodeGroup = nodeGroups.find((candidate) => String(metadataOf(candidate).name || candidate?.name || "") === name) || null;
    if (nodeGroup) {
      nodeGroupRef = name;
      item = buildNodeGroupEdgeUnitView(nodeGroup, aux, new Set(nodeGroupByName.keys()));
    }
  }

  if (!item) {
    return { status: 404, body: { message: `EdgeUnit ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  const resources = buildEdgeUnitResourceSet(nodeGroup, aux, name, nodeGroupRef, new Set(nodeGroupByName.keys()));
  const explicitNodeNames = nodeGroup ? explicitNodeNamesOf(nodeGroup) : [];
  const nodeNames = Array.from(new Set([
    ...explicitNodeNames,
    ...resources.nodes.map((node) => nodeNameOf(node)).filter(Boolean),
  ]));

  return {
    status: 200,
    body: {
      item: {
        edgeUnit: item,
        nodeGroupRef,
        nodeNames,
        deployments: resources.deployments.map(resourceRef).filter((ref) => ref.name),
        edgeApplications: resources.edgeApplications.map(resourceRef).filter((ref) => ref.name),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

export async function updateEdgeUnit(name: string, body: any) {
  const warnings: EdgeUnitWarning[] = [];

  if (Object.prototype.hasOwnProperty.call(body || {}, "name")) {
    return { status: 400, body: { message: "name is immutable" } };
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

  const data = dataOf(configMap);
  if (data.nodeGroupRef) {
    const nodeGroup = await getNodeGroupByName(data.nodeGroupRef);
    if (!nodeGroup) {
      return { status: 400, body: { message: `NodeGroup ${data.nodeGroupRef} does not exist` } };
    }
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
