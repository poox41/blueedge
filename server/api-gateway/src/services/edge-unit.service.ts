import {
  blueedgeNamespace,
  blueedgeResourceLabel,
  create,
  edgeUnitResourceValue,
  ensureNamespace,
  remove,
  update,
} from "../repositories/blueedge-configmap.repository.js";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
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
  edgeUnitConfigMapMatches,
  edgeUnitConfigMapName,
  edgeUnitConfigMapResourceName,
  edgeUnitNameLabel,
  getEdgeUnitConfigMaps,
  isValidEdgeUnitConfigMap,
} from "./edge-unit-source.service.js";
import { edgeApplicationTargetsOnlyMatchingNodes } from "./edge-application-placement.service.js";

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
  const accessType = normalizeEdgeUnitAccessType(readStringField(body, "accessType") ?? existingData?.accessType);
  const insightStatus = normalizeEdgeUnitComponentState(readStringField(body, "insightStatus") ?? existingData?.insightStatus);
  const monitorStatus = normalizeEdgeUnitComponentState(readStringField(body, "monitorStatus") ?? existingData?.monitorStatus);

  if (!accessType) throw new Error("accessType must be one of external, dedicated, unknown");
  if (!insightStatus) throw new Error("insightStatus must be one of installed, notInstalled, unknown");
  if (!monitorStatus) throw new Error("monitorStatus must be one of installed, notInstalled, unknown");

  return {
    name,
    // EdgeUnit ownership is expressed with blueedge.io/edge-unit labels.
    // Keep the legacy field empty so updates also remove historical bindings.
    nodeGroupRef: "",
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

export function deploymentTargetsEdgeUnit(deployment: any, edgeUnitName: string): boolean {
  const records = [
    labelsOf(deployment),
    annotationsOf(deployment),
    labelsOf(deployment?.spec?.template),
    annotationsOf(deployment?.spec?.template),
  ];
  return records.some((record) => [record["blueedge.io/edge-unit"], record.edgeUnit]
    .some((value) => String(value || "") === edgeUnitName));
}

export function deploymentBelongsToEdgeUnit(deployment: any, edgeUnitName: string): boolean {
  return deploymentTargetsEdgeUnit(deployment, edgeUnitName);
}

export function bindDeploymentToEdgeUnit(resource: any, edgeUnitName: string) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) throw new Error("Deployment 请求体无效");
  if (String(resource.apiVersion || "apps/v1") !== "apps/v1" || String(resource.kind || "Deployment") !== "Deployment") {
    throw new Error("只支持 apps/v1 Deployment");
  }
  const metadata = metadataOf(resource);
  const name = String(metadata.name || "").trim();
  const namespace = String(metadata.namespace || "default").trim();
  if (!name) throw new Error("Deployment metadata.name 不能为空");
  if (!resource?.spec?.template?.spec) throw new Error("Deployment spec.template.spec 不能为空");

  const next = structuredClone(resource);
  next.apiVersion = "apps/v1";
  next.kind = "Deployment";
  next.metadata = {
    ...(next.metadata || {}),
    name,
    namespace,
    labels: { ...(next.metadata?.labels || {}), "blueedge.io/edge-unit": edgeUnitName },
  };
  next.spec.template.metadata = {
    ...(next.spec.template.metadata || {}),
    labels: { ...(next.spec.template.metadata?.labels || {}), "blueedge.io/edge-unit": edgeUnitName },
  };
  if (!String(next.spec.template.spec.nodeName || "").trim()) {
    next.spec.template.spec.nodeSelector = {
      ...(next.spec.template.spec.nodeSelector || {}),
      "blueedge.io/node-role": "edge",
    };
  }
  return next;
}

export function deploymentRunsOnNodes(deployment: any, pods: any[], nodeNames: Set<string>): boolean {
  const selector = selectorOfWorkload(deployment);
  const metadata = metadataOf(deployment);
  const namespace = String(metadata.namespace || deployment?.namespace || "default");
  const matchingPods = pods.filter((pod) =>
    podNamespace(pod) === namespace && podBelongsToDeployment(pod, deployment, selector),
  );
  const activeScheduledPods = matchingPods.filter((pod) => isActiveScheduledPod(pod));
  if (activeScheduledPods.length > 0) {
    return activeScheduledPods.some((pod) => nodeNames.has(String(pod?.spec?.nodeName || "")));
  }
  return matchingPods.some((pod) =>
    metadataOf(pod).deletionTimestamp && nodeNames.has(String(pod?.spec?.nodeName || "")),
  );
}

function isActiveScheduledPod(pod: any): boolean {
  const phase = String(pod?.status?.phase || "");
  return !metadataOf(pod).deletionTimestamp &&
    !["Succeeded", "Failed"].includes(phase) &&
    Boolean(String(pod?.spec?.nodeName || ""));
}

function deploymentHasActiveScheduledPods(deployment: any, pods: any[]): boolean {
  const selector = selectorOfWorkload(deployment);
  const metadata = metadataOf(deployment);
  const namespace = String(metadata.namespace || deployment?.namespace || "default");
  return pods.some((pod) =>
    isActiveScheduledPod(pod) &&
    podNamespace(pod) === namespace &&
    podBelongsToDeployment(pod, deployment, selector),
  );
}

function podBelongsToDeployment(pod: any, deployment: any, selector = selectorOfWorkload(deployment)): boolean {
  const ownerReferences = Array.isArray(metadataOf(pod).ownerReferences) ? metadataOf(pod).ownerReferences : [];
  const deploymentName = String(metadataOf(deployment).name || deployment?.name || "");
  if (ownerReferences.length > 0) {
    return ownerReferences.some((owner: any) =>
      String(owner?.kind || "") === "ReplicaSet" && replicaSetBelongsToDeployment(String(owner?.name || ""), deploymentName),
    );
  }
  return Object.keys(selector).length > 0 && podMatchesSelector(pod, selector);
}

function replicaSetBelongsToDeployment(replicaSetName: string, deploymentName: string): boolean {
  const prefix = `${deploymentName}-`;
  if (!deploymentName || !replicaSetName.startsWith(prefix)) return false;
  // Deployment ReplicaSets are named <deployment>-<pod-template-hash>.
  // Reject a longer Deployment name such as "ov-model-blueedge-import-<hash>"
  // when evaluating the shorter "ov-model" Deployment.
  const hash = replicaSetName.slice(prefix.length);
  return Boolean(hash) && !hash.includes("-");
}

export function deploymentTargetsNodes(deployment: any, allNodes: any[], nodeNames: Set<string>): boolean {
  const podSpec = deployment?.spec?.template?.spec || {};
  const nodeName = String(podSpec.nodeName || "");
  if (nodeName) return nodeNames.has(nodeName);

  const nodeSelector = podSpec.nodeSelector && typeof podSpec.nodeSelector === "object" && !Array.isArray(podSpec.nodeSelector)
    ? Object.fromEntries(Object.entries(podSpec.nodeSelector).map(([key, value]) => [key, String(value)]))
    : {};
  if (nodeSelector["blueedge.io/node-role"] === "edge") return true;
  if (Object.keys(nodeSelector).length > 0) {
    const matchingNodes = allNodes.filter((node) => nodeMatchesSelector(node, nodeSelector));
    if (matchingNodes.length > 0 && matchingNodes.every((node) => nodeNames.has(nodeNameOf(node)))) return true;
  }

  const terms = podSpec?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms;
  if (!Array.isArray(terms)) return false;
  const matchingNodes = allNodes.filter((node) => terms.some((term: any) => nodeMatchesAffinityTerm(node, term)));
  return matchingNodes.length > 0 && matchingNodes.every((node) => nodeNames.has(nodeNameOf(node)));
}

function nodeMatchesAffinityTerm(node: any, term: any): boolean {
  const expressions = Array.isArray(term?.matchExpressions) ? term.matchExpressions : [];
  const fields = Array.isArray(term?.matchFields) ? term.matchFields : [];
  return expressions.every((expression: any) => nodeRequirementMatches(labelsOf(node), expression)) &&
    fields.every((field: any) => nodeRequirementMatches({ "metadata.name": nodeNameOf(node) }, field));
}

function nodeRequirementMatches(values: Record<string, string>, requirement: any): boolean {
  const key = String(requirement?.key || "");
  const operator = String(requirement?.operator || "");
  const expected = Array.isArray(requirement?.values) ? requirement.values.map(String) : [];
  const exists = Object.prototype.hasOwnProperty.call(values, key);
  const actual = String(values[key] || "");
  if (operator === "In") return exists && expected.includes(actual);
  if (operator === "NotIn") return exists && !expected.includes(actual);
  if (operator === "Exists") return exists;
  if (operator === "DoesNotExist") return !exists;
  if (operator === "Gt") return exists && expected.length === 1 && Number(actual) > Number(expected[0]);
  if (operator === "Lt") return exists && expected.length === 1 && Number(actual) < Number(expected[0]);
  return false;
}

async function validateExplicitDeploymentNode(deployment: any): Promise<void> {
  const nodeName = String(deployment?.spec?.template?.spec?.nodeName || "").trim();
  if (!nodeName) return;
  const node = await getK8sJson(`/api/v1/nodes/${encodeURIComponent(nodeName)}`);
  if (!isExternalEdgeNode(node)) throw new Error(`节点 ${nodeName} 不是边缘节点`);
}

export function deploymentPodsOnNodes(deployment: any, pods: any[], nodeNames: Set<string>): any[] {
  if (nodeNames.size === 0) return [];
  const selector = selectorOfWorkload(deployment);
  if (Object.keys(selector).length === 0) return [];
  const metadata = metadataOf(deployment);
  const namespace = String(metadata.namespace || deployment?.namespace || "default");
  return pods.filter((pod) =>
    nodeNames.has(String(pod?.spec?.nodeName || "")) &&
    podNamespace(pod) === namespace &&
    podBelongsToDeployment(pod, deployment, selector),
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

export function isExternalEdgeNode(node: any): boolean {
  const labels = labelsOf(node);
  if (Object.prototype.hasOwnProperty.call(labels, "node-role.kubernetes.io/edge")) return true;
  if (!Object.prototype.hasOwnProperty.call(labels, "node-role.kubernetes.io/agent")) return false;

  const kubeletVersion = String(
    node?.status?.nodeInfo?.kubeletVersion ||
    node?.nodeInfo?.kubeletVersion ||
    node?.kubeletVersion ||
    "",
  ).toLowerCase();
  return kubeletVersion.includes("kubeedge");
}

export function isDeploymentHealthy(deployment: any): boolean {
  const replicas = Number(deployment?.spec?.replicas ?? deployment?.replicas ?? 1);
  const available = Number(deployment?.status?.availableReplicas ?? deployment?.availableReplicas ?? 0);
  return replicas > 0 && available >= replicas;
}

function isCloudCoreResource(resource: any): boolean {
  const metadata = metadataOf(resource);
  const labels = labelsOf(resource);
  const name = String(metadata.name || resource?.name || "").toLowerCase();
  const containers = Array.isArray(resource?.spec?.template?.spec?.containers)
    ? resource.spec.template.spec.containers
    : Array.isArray(resource?.spec?.containers)
      ? resource.spec.containers
      : [];
  return name === "cloudcore" || name.startsWith("cloudcore-") ||
    String(labels.kubeedge || "").toLowerCase() === "cloudcore" ||
    containers.some((container: any) => String(container?.name || "").toLowerCase() === "cloudcore");
}

export function cloudCoreRuntimeStatus(deployments: any[], pods: any[]): "running" | "abnormal" | "unknown" {
  const cloudCoreDeployments = deployments.filter(isCloudCoreResource);
  if (cloudCoreDeployments.length > 0) {
    return cloudCoreDeployments.some((deployment) => {
      const desired = Number(deployment?.spec?.replicas ?? deployment?.replicas ?? 1);
      const available = Number(deployment?.status?.availableReplicas ?? deployment?.availableReplicas ?? 0);
      const ready = Number(deployment?.status?.readyReplicas ?? deployment?.readyReplicas ?? 0);
      return desired > 0 && available >= desired && ready >= desired;
    }) ? "running" : "abnormal";
  }

  const cloudCorePods = pods.filter(isCloudCoreResource);
  if (cloudCorePods.length === 0) return "unknown";
  return cloudCorePods.some((pod) => {
    if (metadataOf(pod).deletionTimestamp || String(pod?.status?.phase || "") !== "Running") return false;
    const conditions = Array.isArray(pod?.status?.conditions) ? pod.status.conditions : [];
    return conditions.some((condition: any) => condition?.type === "Ready" && condition?.status === "True");
  }) ? "running" : "abnormal";
}

export function edgeApplicationTargetsNodeGroup(app: any, nodeGroupName: string): boolean {
  const targetNodeGroups = app?.spec?.workloadScope?.targetNodeGroups;
  if (!Array.isArray(targetNodeGroups)) return false;
  return targetNodeGroups.some((group: any) => String(typeof group === "string" ? group : group?.name || "") === nodeGroupName);
}

export function edgeApplicationTargetsEdgeUnit(app: any, edgeUnitName: string): boolean {
  const workloadTemplate = app?.spec?.workloadTemplate;
  const manifests = Array.isArray(workloadTemplate?.manifests) ? workloadTemplate.manifests : [];
  return resourceDirectlyTargetsEdgeUnit(app, edgeUnitName) ||
    resourceDirectlyTargetsEdgeUnit(workloadTemplate, edgeUnitName) ||
    manifests.some((manifest: any) => resourceDirectlyTargetsEdgeUnit(manifest, edgeUnitName));
}

export function edgeApplicationBelongsToEdgeUnit(
  app: any,
  edgeUnitName: string,
): boolean {
  return edgeApplicationTargetsEdgeUnit(app, edgeUnitName);
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
  aux: EdgeUnitAuxSources,
  edgeUnitName: string,
  options: { accessType?: "external" | "dedicated" | "unknown" } = {},
) {
  const directlyOwnedNodes = aux.nodes.filter(isExternalEdgeNode);
  const nodes = uniqueResources(directlyOwnedNodes);
  const nodeNames = new Set(nodes.map(nodeNameOf).filter(Boolean));
  const deployments = aux.deployments.filter((item) => {
    const runsOnEdge = deploymentRunsOnNodes(item, aux.pods, nodeNames);
    if (deploymentHasActiveScheduledPods(item, aux.pods)) return runsOnEdge;
    return runsOnEdge || deploymentTargetsNodes(item, aux.nodes, nodeNames);
  });
  const nodeGroups = aux.nodeGroups || [];
  const groupsByName = new Map(nodeGroups.map((group) => [String(metadataOf(group).name || group?.name || ""), group]));
  const edgeApplications = aux.nodeGroups
    ? aux.edgeApplications.filter((item) => edgeApplicationTargetsOnlyMatchingNodes(item, groupsByName, aux.nodes, isExternalEdgeNode))
    : aux.edgeApplications;
  return { nodes, deployments, edgeApplications };
}

export function buildEdgeUnitRuntime(
  aux: EdgeUnitAuxSources,
  edgeUnitName: string,
  options: { accessType?: "external" | "dedicated" | "unknown" } = {},
) {
  const resources = buildEdgeUnitResourceSet(aux, edgeUnitName, options);
  const nodeTotal = resources.nodes.length;
  const nodeReady = resources.nodes.filter(isNodeReady).length;
  const nodeNames = new Set(resources.nodes.map(nodeNameOf).filter(Boolean));
  const status = cloudCoreRuntimeStatus(aux.deployments, aux.pods);

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

function buildConfigMapEdgeUnitView(configMap: any, aux: EdgeUnitAuxSources) {
  const metadata = metadataOf(configMap);
  const data = dataOf(configMap);
  const name = data.name;
  const accessType = normalizeAccessType(data.accessType || "unknown");
  const runtime = buildEdgeUnitRuntime(aux, name, { accessType });

  return {
    name,
    status: runtime.status,
    accessType,
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
    },
  };
}

async function findEdgeUnitConfigMap(name: string, warnings: EdgeUnitWarning[]): Promise<any | null> {
  const configMaps = await getEdgeUnitConfigMaps(warnings);
  return configMaps.find((configMap) => edgeUnitConfigMapMatches(configMap, name)) || null;
}

async function buildConfigMapEdgeUnitResponse(configMap: any, warnings: EdgeUnitWarning[]) {
  const aux = await collectEdgeUnitAuxSources(warnings);

  return {
    item: buildConfigMapEdgeUnitView(configMap, aux),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function validationError(error: unknown) {
  return { status: 400, body: { message: error instanceof Error ? error.message : "Invalid EdgeUnit payload" } };
}

export function findEdgeUnitClusterConflict(configMaps: any[], clusterName: string, excludedEdgeUnitName = ""): string | null {
  const targetCluster = clusterName.trim();
  if (!targetCluster) return null;

  const conflict = configMaps.find((configMap) => {
    const edgeUnitName = edgeUnitConfigMapName(configMap);
    return edgeUnitName !== excludedEdgeUnitName && String(dataOf(configMap).clusterName || "").trim() === targetCluster;
  });
  return conflict ? edgeUnitConfigMapName(conflict) : null;
}

export async function listEdgeUnits() {
  const warnings: EdgeUnitWarning[] = [];
  const edgeUnitConfigMaps = await getEdgeUnitConfigMaps(warnings);
  const validEdgeUnitConfigMaps = edgeUnitConfigMaps.filter((configMap) => isValidEdgeUnitConfigMap(configMap, warnings));

  const aux = await collectEdgeUnitAuxSources(warnings);

  return {
    items: validEdgeUnitConfigMaps.map((configMap) => buildConfigMapEdgeUnitView(configMap, aux)),
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
  if (!data.clusterName) {
    return { status: 400, body: { message: "工作集群不能为空" } };
  }

  const edgeUnitConfigMaps = await getEdgeUnitConfigMaps(warnings);
  const duplicated = edgeUnitConfigMaps.find((item) => edgeUnitConfigMapMatches(item, data.name));
  if (duplicated) {
    return { status: 409, body: { message: `EdgeUnit ${data.name} already exists`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const clusterConflict = findEdgeUnitClusterConflict(edgeUnitConfigMaps, data.clusterName);
  if (clusterConflict) {
    return { status: 409, body: { message: `工作集群 ${data.clusterName} 已安装边缘单元 ${clusterConflict}，一个工作集群只能创建一个边缘单元`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  await ensureNamespace();
  const created = await create(configMap);
  return { status: 201, body: await buildConfigMapEdgeUnitResponse(created, warnings) };
}

export async function getEdgeUnit(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const { edgeUnitConfigMaps, aux } = await collectEdgeUnitSources(warnings, { includeNodeGroups: false });
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
      return {
        status: 200,
        body: {
          item: buildConfigMapEdgeUnitView(matchedConfigMap, aux),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    }
  }

  return { status: 404, body: { message: `EdgeUnit ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function getEdgeUnitResources(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const { edgeUnitConfigMaps, aux } = await collectEdgeUnitSources(warnings, { includeNodeGroups: false });
  const matchedConfigMap = edgeUnitConfigMaps.find((configMap) => edgeUnitConfigMapMatches(configMap, name));
  if (!matchedConfigMap || !isValidEdgeUnitConfigMap(matchedConfigMap, warnings)) {
    return { status: 404, body: { message: `EdgeUnit ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  const item = buildConfigMapEdgeUnitView(matchedConfigMap, aux);
  const accessType = normalizeAccessType(dataOf(matchedConfigMap).accessType || "unknown");
  const resources = buildEdgeUnitResourceSet(aux, name, { accessType });
  const nodeNames = Array.from(new Set(resources.nodes.map((node) => nodeNameOf(node)).filter(Boolean)));

  return {
    status: 200,
    body: {
      item: {
        edgeUnit: item,
        nodeNames,
        deployments: resources.deployments.map(resourceRef).filter((ref) => ref.name),
        edgeApplications: resources.edgeApplications.map(resourceRef).filter((ref) => ref.name),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

export async function createEdgeUnitDeployment(edgeUnitName: string, resource: any) {
  try {
    const deployment = bindDeploymentToEdgeUnit(resource, edgeUnitName);
    await validateExplicitDeploymentNode(deployment);
    const namespace = String(deployment.metadata.namespace || "default");
    const created = await requestK8sJson(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments`, {
      method: "POST",
      body: deployment,
    });
    return { status: 201, body: created };
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作负载创建失败";
    const status = /未绑定|不存在|不能为空|无效|只支持|冲突|不属于|没有配置/.test(message) ? 400 : 500;
    return { status, body: { message } };
  }
}

export async function updateEdgeUnitDeployment(edgeUnitName: string, namespace: string, name: string, resource: any) {
  try {
    const path = `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`;
    const existing = await getK8sJson(path);
    const deployment = bindDeploymentToEdgeUnit({
      ...resource,
      metadata: {
        ...(resource?.metadata || {}),
        name,
        namespace,
        resourceVersion: metadataOf(existing).resourceVersion,
      },
    }, edgeUnitName);
    await validateExplicitDeploymentNode(deployment);
    const updated = await requestK8sJson(path, { method: "PUT", body: deployment });
    return { status: 200, body: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : "工作负载更新失败";
    const status = /未绑定|不存在|不能为空|无效|只支持|冲突|不属于|没有配置/.test(message) ? 400 : 500;
    return { status, body: { message } };
  }
}

export async function updateEdgeUnit(name: string, body: any) {
  const warnings: EdgeUnitWarning[] = [];

  if (Object.prototype.hasOwnProperty.call(body || {}, "name")) {
    return { status: 400, body: { message: "name is immutable" } };
  }

  const existing = await findEdgeUnitConfigMap(name, warnings);
  if (!existing) {
    return {
      status: 404,
      body: {
        message: `EdgeUnit ${name} not found`,
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
  if (!data.clusterName) {
    return { status: 400, body: { message: "工作集群不能为空" } };
  }
  const edgeUnitConfigMaps = await getEdgeUnitConfigMaps(warnings);
  const clusterConflict = findEdgeUnitClusterConflict(edgeUnitConfigMaps, data.clusterName, name);
  if (clusterConflict) {
    return { status: 409, body: { message: `工作集群 ${data.clusterName} 已安装边缘单元 ${clusterConflict}，一个工作集群只能创建一个边缘单元`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  const updated = await update(metadataOf(existing).name, configMap);
  return { status: 200, body: await buildConfigMapEdgeUnitResponse(updated, warnings) };
}

export async function deleteEdgeUnit(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const existing = await findEdgeUnitConfigMap(name, warnings);

  if (!existing) {
    return {
      status: 404,
      body: {
        message: `EdgeUnit ${name} not found`,
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
          message: `EdgeUnit ${name} metadata deleted. Labeled Kubernetes and KubeEdge resources are retained.`,
        },
      ],
    },
  };
}
