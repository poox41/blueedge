import { getJson } from "../clients/bff-client.js";
import { getK8sJson } from "../clients/k8s-client.js";
import type { ResourceSummaryResult } from "../types/resource-summary.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  annotationsOf,
  dataOf,
  explicitNodeNamesOf,
  getResourceEvents,
  isNodeReady,
  itemsOf,
  labelsOf,
  metadataOf,
  nodeGroupSelectorOf,
  nodeInternalIP,
  nodeMatchesSelector,
  nodeNameOf,
  podIsRunning,
  podSummaryItem,
  warning,
} from "../utils/kubernetes.js";
import { listAccessConfigViewsForNodes } from "./access-config.service.js";
import {
  collectEdgeUnitSources,
  edgeUnitConfigMapName,
  isValidEdgeUnitConfigMap,
} from "./edge-unit-source.service.js";
import { getNodeSummaryMetrics } from "./observability.service.js";

function nodeRoles(node: any): string[] {
  return Object.keys(labelsOf(node))
    .filter((key) => key.startsWith("node-role.kubernetes.io/"))
    .map((key) => key.replace("node-role.kubernetes.io/", "") || "node");
}

function nodeMatchesNodeGroup(node: any, nodeGroup: any): boolean {
  const explicit = explicitNodeNamesOf(nodeGroup);
  if (explicit.length > 0) return explicit.includes(nodeNameOf(node));
  return nodeMatchesSelector(node, nodeGroupSelectorOf(nodeGroup));
}

async function getPodsForNode(nodeName: string, warnings: EdgeUnitWarning[]) {
  const data = await getK8sJson(`/api/v1/pods?fieldSelector=${encodeURIComponent(`spec.nodeName=${nodeName}`)}`).catch((error) => {
    warnings.push(warning("pods", error, "pod list unavailable"));
    return null;
  });
  return itemsOf(data);
}

export async function getNodeSummary(name: string): Promise<ResourceSummaryResult> {
  const warnings: EdgeUnitWarning[] = [];
  const node = await getK8sJson(`/api/v1/nodes/${encodeURIComponent(name)}`).catch(async (error) => {
    try {
      return await getJson(`/node/${encodeURIComponent(name)}`);
    } catch {
      throw error;
    }
  });
  if (!node) throw new Error(`Node ${name} not found`);

  const [pods, metrics, events, accessConfigs, edgeSources] = await Promise.all([
    getPodsForNode(name, warnings),
    getNodeSummaryMetrics(name, warnings),
    getResourceEvents("", "Node", name, warnings),
    listAccessConfigViewsForNodes(warnings, [node]).catch((error) => {
      warnings.push(warning("access-config", error, "AccessConfig unavailable"));
      return [];
    }),
    collectEdgeUnitSources(warnings, { includeConfigMaps: true, includeNodeGroups: true }).catch((error) => {
      warnings.push(warning("edgeunit", error, "EdgeUnit sources unavailable"));
      return { edgeUnitConfigMaps: [], nodeGroups: [], nodeGroupByName: new Map<string, any>(), aux: { nodes: [], deployments: [], edgeApplications: [] } };
    }),
  ]);
  const accessConfig = accessConfigs.find((item) => item.nodeName === name) || null;
  const nodeGroupRefs = edgeSources.nodeGroups
    .filter((item: any) => nodeMatchesNodeGroup(node, item))
    .map((item: any) => String(metadataOf(item).name || item?.name || ""));
  const edgeUnitConfig = edgeSources.edgeUnitConfigMaps
    .filter((item: any) => isValidEdgeUnitConfigMap(item, warnings))
    .find((item: any) => nodeGroupRefs.includes(dataOf(item).nodeGroupRef));
  const nodeInfo = node?.status?.nodeInfo || {};
  const podItems = pods.map(podSummaryItem);

  return {
    item: {
      name,
      status: isNodeReady(node) ? "ready" : "notReady",
      roles: nodeRoles(node),
      architecture: nodeInfo.architecture || labelsOf(node)["kubernetes.io/arch"] || "",
      os: nodeInfo.operatingSystem || labelsOf(node)["kubernetes.io/os"] || "",
      kernelVersion: nodeInfo.kernelVersion || "",
      containerRuntime: nodeInfo.containerRuntimeVersion || "",
      kubeletVersion: nodeInfo.kubeletVersion || "",
      kubeEdgeVersion: annotationsOf(node)["kubeedge.io/version"] || annotationsOf(node)["blueedge.io/kubeedge-version"] || "",
      internalIP: nodeInternalIP(node),
      createdAt: metadataOf(node).creationTimestamp || "",
      conditions: Array.isArray(node?.status?.conditions) ? node.status.conditions : [],
      labels: labelsOf(node),
      annotations: annotationsOf(node),
      metrics,
      pods: {
        total: podItems.length,
        running: pods.filter(podIsRunning).length,
        abnormal: pods.filter((pod) => !podIsRunning(pod)).length,
        items: podItems,
      },
      events,
      accessConfig,
      edgeUnitRef: edgeUnitConfig ? edgeUnitConfigMapName(edgeUnitConfig) : "",
      nodeGroupRefs,
      raw: node,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
