import { getK8sJson } from "../clients/k8s-client.js";
import type { ResourceSummaryResult } from "../types/resource-summary.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  annotationsOf,
  getResourceEvents,
  isNodeReady,
  labelsOf,
  metadataOf,
  nodeInternalIP,
  nodeNameOf,
  podPhase,
  podRestartCount,
  warning,
} from "../utils/kubernetes.js";
import { getPodSummaryMetrics, getPodSummaryRecentLogs } from "./observability.service.js";

export async function getPodSummary(namespace: string, name: string, query: { container?: unknown; tailLines?: unknown }): Promise<ResourceSummaryResult> {
  const warnings: EdgeUnitWarning[] = [];
  const pod = await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`);
  const container = typeof query.container === "string" ? query.container : "";
  const tailLines = typeof query.tailLines === "string" ? query.tailLines : "100";
  const [metrics, events, logs, node] = await Promise.all([
    getPodSummaryMetrics(namespace, name, warnings),
    getResourceEvents(namespace, "Pod", name, warnings),
    getPodSummaryRecentLogs(namespace, name, container, tailLines, warnings),
    pod?.spec?.nodeName ? getK8sJson(`/api/v1/nodes/${encodeURIComponent(pod.spec.nodeName)}`).catch((error) => {
      warnings.push(warning("node", error, "node unavailable"));
      return null;
    }) : Promise.resolve(null),
  ]);
  const ownerRef = Array.isArray(metadataOf(pod).ownerReferences) ? metadataOf(pod).ownerReferences[0] : null;

  return {
    item: {
      name,
      namespace,
      status: podPhase(pod),
      phase: podPhase(pod),
      nodeName: pod?.spec?.nodeName || "",
      podIP: pod?.status?.podIP || "",
      hostIP: pod?.status?.hostIP || "",
      createdAt: metadataOf(pod).creationTimestamp || "",
      restartCount: podRestartCount(pod),
      containers: Array.isArray(pod?.spec?.containers) ? pod.spec.containers : [],
      conditions: Array.isArray(pod?.status?.conditions) ? pod.status.conditions : [],
      metrics,
      events,
      recentLogs: logs,
      owner: ownerRef ? { kind: ownerRef.kind, name: ownerRef.name } : null,
      node: node ? { name: nodeNameOf(node), status: isNodeReady(node) ? "ready" : "notReady", internalIP: nodeInternalIP(node) } : null,
      labels: labelsOf(pod),
      annotations: annotationsOf(pod),
      raw: pod,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
