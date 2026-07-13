import { getJson } from "../clients/bff-client.js";
import { getK8sJson } from "../clients/k8s-client.js";
import type { ResourceSummaryResult } from "../types/resource-summary.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  annotationsOf,
  containedResourceRefs,
  explicitNodeNamesOf,
  itemsOf,
  labelsOf,
  metadataOf,
  nodeGroupSelectorOf,
  podIsRunning,
  podMatchesSelector,
  podSummaryItem,
  selectorOfWorkload,
  targetNodeGroupsOfEdgeApp,
  warning,
  workloadManifestOfEdgeApp,
} from "../utils/kubernetes.js";
import { collectNodeGroupDetails } from "./edge-unit-source.service.js";
import { deploymentTargetsEdgeUnit, isDeploymentHealthy } from "./edge-unit.service.js";
import { getSummaryResourceEvents } from "./observability.service.js";

function inferEdgeAppStatus(app: any, deployments: any[], pods: any[]): string {
  const explicit = String(app?.status?.phase || app?.status?.status || app?.status?.state || "").toLowerCase();
  if (["ready", "running", "success", "succeeded", "available"].includes(explicit)) return "running";
  if (["failed", "error"].includes(explicit)) return "failed";
  if (app?.spec?.paused) return "paused";
  if (deployments.some(isDeploymentHealthy)) return "running";
  if (pods.some(podIsRunning)) return "running";
  return "unknown";
}

export async function getEdgeAppSummary(namespace: string, name: string): Promise<ResourceSummaryResult> {
  const warnings: EdgeUnitWarning[] = [];
  const appResource = await getJson(`/edgeapplication/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`).catch((error) => {
    throw error;
  });
  const targetNodeGroups = targetNodeGroupsOfEdgeApp(appResource);
  const refs = containedResourceRefs(appResource);
  const workload = workloadManifestOfEdgeApp(appResource);
  const selector = selectorOfWorkload(workload);
  const [nodeGroupDetails, deploymentsRaw, podsRaw, events] = await Promise.all([
    collectNodeGroupDetails(warnings).catch((error) => {
      warnings.push(warning("nodegroup", error, "NodeGroup list unavailable"));
      return { nodeGroups: [], nodeGroupByName: new Map<string, any>(), nodeGroupError: error };
    }),
    getJson("/deployment").then(itemsOf).catch((error) => {
      warnings.push(warning("deployment", error, "Deployment list unavailable"));
      return [];
    }),
    getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`).then(itemsOf).catch((error) => {
      warnings.push(warning("pod", error, "Pod list unavailable"));
      return [];
    }),
    getSummaryResourceEvents(namespace, "EdgeApplication", name, warnings),
  ]);
  const refNames = refs.filter((ref) => ref.kind === "Deployment").map((ref) => ref.name).filter(Boolean);
  const deployments = deploymentsRaw.filter((item) => {
    const metadata = metadataOf(item);
    return metadata.namespace === namespace && (refNames.includes(metadata.name) || deploymentTargetsEdgeUnit(item, name, targetNodeGroups[0] || ""));
  });
  const pods = podsRaw.filter((pod) => podMatchesSelector(pod, selector) || deployments.some((deployment) => podMatchesSelector(pod, selectorOfWorkload(deployment))));
  const nodeGroups = targetNodeGroups.map((groupName) => {
    const group = nodeGroupDetails.nodeGroupByName.get(groupName);
    return group ? { name: groupName, matchLabels: nodeGroupSelectorOf(group), explicitNodes: explicitNodeNamesOf(group) } : { name: groupName, missing: true };
  });

  return {
    item: {
      name,
      namespace,
      status: inferEdgeAppStatus(appResource, deployments, pods),
      targetNodeGroups,
      nodeGroups,
      workloads: [
        ...(workload ? [{ kind: workload.kind || "Deployment", name: workload?.metadata?.name || name, selector }] : []),
        ...deployments.map((item) => ({
          kind: item.kind || "Deployment",
          name: metadataOf(item).name || "",
          availableReplicas: item?.status?.availableReplicas || 0,
          replicas: item?.spec?.replicas || 1,
        })),
      ],
      pods: pods.map(podSummaryItem),
      events,
      metrics: null,
      createdAt: metadataOf(appResource).creationTimestamp || "",
      yaml: appResource,
      labels: labelsOf(appResource),
      annotations: annotationsOf(appResource),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
