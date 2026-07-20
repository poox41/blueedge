import { getJson } from "../clients/bff-client.js";
import type { ResourceSummaryResult } from "../types/resource-summary.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  annotationsOf,
  explicitNodeNamesOf,
  isNodeReady,
  itemsOf,
  labelsOf,
  metadataOf,
  nodeGroupSelectorOf,
  nodeInternalIP,
  nodeNameOf,
  warning,
} from "../utils/kubernetes.js";
import { listBatchTaskViewsForSummary } from "./batch-task.service.js";
import {
  getEdgeUnitNodes,
  getNodeGroupByName,
} from "./edge-unit-source.service.js";
import {
  annotationValue,
  edgeApplicationTargetsNodeGroup,
  isEdgeApplicationHealthy,
  nodesForNodeGroup,
} from "./edge-unit.service.js";

export async function getNodeGroupSummary(name: string): Promise<ResourceSummaryResult | null> {
  const warnings: EdgeUnitWarning[] = [];
  const nodeGroup = await getNodeGroupByName(name);
  if (!nodeGroup) return null;

  const [nodes, edgeApplications, batchTasks] = await Promise.all([
    getEdgeUnitNodes(warnings).catch((error) => {
      warnings.push(warning("node", error, "Node list unavailable"));
      return [];
    }),
    getJson("/edgeapplication").then(itemsOf).catch((error) => {
      warnings.push(warning("edgeapplication", error, "EdgeApplication list unavailable"));
      return [];
    }),
    listBatchTaskViewsForSummary(warnings),
  ]);
  const matchedNodes = nodesForNodeGroup(nodeGroup, nodes);
  const apps = edgeApplications.filter((item) => edgeApplicationTargetsNodeGroup(item, name));
  const taskCount = batchTasks.filter((item) => item.targetRefs.includes(name)).length;

  return {
    item: {
      name,
      createdAt: metadataOf(nodeGroup).creationTimestamp || nodeGroup?.creationTimestamp || "",
      selectorType: explicitNodeNamesOf(nodeGroup).length > 0 ? "nodes" : "matchLabels",
      explicitNodes: explicitNodeNamesOf(nodeGroup),
      matchLabels: nodeGroupSelectorOf(nodeGroup),
      matchedNodes: matchedNodes.map(nodeNameOf),
      nodes: {
        ready: matchedNodes.filter(isNodeReady).length,
        total: explicitNodeNamesOf(nodeGroup).length || matchedNodes.length,
        items: matchedNodes.map((node) => ({
          name: nodeNameOf(node),
          status: isNodeReady(node) ? "ready" : "notReady",
          internalIP: nodeInternalIP(node),
          labels: labelsOf(node),
        })),
      },
      edgeUnits: [],
      applications: {
        total: apps.length,
        healthy: apps.filter(isEdgeApplicationHealthy).length,
      },
      batchTasks: { total: taskCount },
      labels: labelsOf(nodeGroup),
      annotations: annotationsOf(nodeGroup),
      description: annotationValue(nodeGroup, ["blueedge.io/description", "description"], ""),
      raw: nodeGroup,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
