import { getJson } from "../clients/bff-client.js";
import { getK8sJson } from "../clients/k8s-client.js";
import {
  accessConfigResourceValue,
  edgeUnitResourceValue,
  listByResourceLabel,
} from "../repositories/blueedge-configmap.repository.js";
import type { EdgeUnitSources, NodeGroupDetails } from "../types/edge-unit.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  dataOf,
  itemsOf,
  labelsOf,
  metadataOf,
  nodeNameOf,
  warning,
} from "../utils/kubernetes.js";

export const edgeUnitNameLabel = "blueedge.io/edge-unit";

export function edgeUnitConfigMapResourceName(name: string): string {
  return `edgeunit-${name}`;
}

function hasNodeLabels(nodes: any[]): boolean {
  return nodes.some((node) => Object.keys(labelsOf(node)).length > 0);
}

export async function getEdgeUnitNodes(warnings: EdgeUnitWarning[]): Promise<any[]> {
  const k8sNodes = await getK8sJson("/api/v1/nodes").catch((error) => {
    warnings.push({ source: "node.k8s", message: error instanceof Error ? error.message : "Kubernetes node list unavailable" });
    return null;
  });
  const k8sItems = itemsOf(k8sNodes);
  if (k8sItems.length > 0) return k8sItems;

  const bffNodes = await getJson("/node").catch((error) => {
    warnings.push({ source: "node", message: error instanceof Error ? error.message : "BFF node list unavailable" });
    return null;
  });
  const bffItems = itemsOf(bffNodes);
  if (bffItems.length > 0 && !hasNodeLabels(bffItems)) {
    warnings.push({ source: "node", message: "BFF node list does not include labels; NodeGroup matchLabels cannot be evaluated accurately" });
  }
  return bffItems;
}

export async function getEdgeUnitConfigMaps(warnings: EdgeUnitWarning[]): Promise<any[]> {
  return listByResourceLabel(edgeUnitResourceValue).catch((error) => {
    warnings.push({ source: "edgeunit.configmap", message: error instanceof Error ? error.message : "EdgeUnit ConfigMap list unavailable" });
    return [];
  });
}

function resourceRefKey(item: any): string {
  const metadata = metadataOf(item);
  const namespace = String(metadata.namespace || item?.namespace || "default");
  const name = String(metadata.name || item?.name || "");
  return `${namespace}/${name}`;
}

export function mergeResourceDetails(
  summaries: any[],
  detailsRaw: any,
  warnings: EdgeUnitWarning[],
  source: string,
): any[] {
  const details = itemsOf(detailsRaw);
  if (summaries.length > 0 && details.length === 0) {
    warnings.push({ source, message: "Kubernetes resource details unavailable; summary data was used instead" });
    return summaries;
  }

  const summaryByRef = new Map(summaries.map((item) => [resourceRefKey(item), item]));
  const merged = details.map((detail) => {
    const summary = summaryByRef.get(resourceRefKey(detail));
    if (!summary) return detail;
    return {
      ...summary,
      ...detail,
      metadata: {
        ...(summary?.metadata || {}),
        ...(detail?.metadata || {}),
      },
    };
  });
  const detailRefs = new Set(details.map(resourceRefKey));
  merged.push(...summaries.filter((summary) => !detailRefs.has(resourceRefKey(summary))));
  return merged;
}

async function getNodeGroupDetailsRaw() {
  const nodeGroupList = await getJson("/nodegroup");
  const nodeGroupSummaries = itemsOf(nodeGroupList);
  return Promise.all(
    nodeGroupSummaries.map(async (item) => {
      const name = metadataOf(item).name || item?.name;
      if (!name) throw new Error("NodeGroup list item is missing name");
      return getJson(`/nodegroup/${encodeURIComponent(String(name))}`);
    }),
  );
}

export async function collectNodeGroupDetails(warnings: EdgeUnitWarning[]): Promise<NodeGroupDetails> {
  const result = await getNodeGroupDetailsRaw()
    .then((data) => ({ status: "fulfilled" as const, value: data }))
    .catch((reason) => ({ status: "rejected" as const, reason }));

  if (result.status === "rejected") {
    warnings.push({
      source: "nodegroup",
      message: result.reason instanceof Error ? result.reason.message : "NodeGroup list unavailable",
    });
    return {
      nodeGroups: [],
      nodeGroupError: result.reason,
      nodeGroupByName: new Map<string, any>(),
    };
  }

  return {
    nodeGroups: result.value,
    nodeGroupError: null,
    nodeGroupByName: new Map(result.value.map((nodeGroup) => [String(metadataOf(nodeGroup).name || nodeGroup?.name || ""), nodeGroup])),
  };
}

export async function collectEdgeUnitAuxSources(warnings: EdgeUnitWarning[]) {
  const [nodes, podsRaw, deploymentsRaw, edgeApplicationsRaw, accessConfigs, k8sDeploymentsRaw, k8sEdgeApplicationsRaw] = await Promise.all([
    getEdgeUnitNodes(warnings),
    getK8sJson("/api/v1/pods").catch(async (k8sError) => {
      const bffPods = await getJson("/pod").catch((bffError) => {
        warnings.push({
          source: "pod",
          message: bffError instanceof Error
            ? bffError.message
            : k8sError instanceof Error
              ? k8sError.message
              : "Pod list unavailable",
        });
        return null;
      });
      return bffPods;
    }),
    getJson("/deployment").then((data) => ({ status: "fulfilled" as const, value: data })).catch((reason) => ({ status: "rejected" as const, reason })),
    getJson("/edgeapplication").then((data) => ({ status: "fulfilled" as const, value: data })).catch((reason) => ({ status: "rejected" as const, reason })),
    listByResourceLabel(accessConfigResourceValue).catch((error) => {
      warnings.push({ source: "access-config.configmap", message: error instanceof Error ? error.message : "AccessConfig ConfigMap list unavailable" });
      return [];
    }),
    getK8sJson("/apis/apps/v1/deployments").catch(() => null),
    getK8sJson("/apis/apps.kubeedge.io/v1alpha1/edgeapplications").catch(() => null),
  ]);

  const deploymentSummaries = deploymentsRaw.status === "fulfilled" ? itemsOf(deploymentsRaw.value) : [];
  const edgeApplicationSummaries = edgeApplicationsRaw.status === "fulfilled" ? itemsOf(edgeApplicationsRaw.value) : [];

  if (deploymentsRaw.status === "rejected") {
    warnings.push({ source: "deployment", message: deploymentsRaw.reason instanceof Error ? deploymentsRaw.reason.message : "Deployment list unavailable" });
  }
  if (edgeApplicationsRaw.status === "rejected") {
    warnings.push({ source: "edgeapplication", message: edgeApplicationsRaw.reason instanceof Error ? edgeApplicationsRaw.reason.message : "EdgeApplication list unavailable" });
  }

  const deployments = mergeResourceDetails(deploymentSummaries, k8sDeploymentsRaw, warnings, "deployment.detail");
  const edgeApplications = mergeResourceDetails(edgeApplicationSummaries, k8sEdgeApplicationsRaw, warnings, "edgeapplication.detail");
  const pods = itemsOf(podsRaw);

  return { nodes, pods, deployments, edgeApplications, accessConfigs };
}

export function edgeUnitConfigMapName(configMap: any): string {
  const data = dataOf(configMap);
  const labels = labelsOf(configMap);
  return data.name || labels[edgeUnitNameLabel] || String(metadataOf(configMap).name || "").replace(/^edgeunit-/, "");
}

export function edgeUnitConfigMapMatches(configMap: any, name: string): boolean {
  const data = dataOf(configMap);
  const labels = labelsOf(configMap);
  const metadata = metadataOf(configMap);
  return data.name === name || labels[edgeUnitNameLabel] === name || metadata.name === edgeUnitConfigMapResourceName(name);
}

export function isValidEdgeUnitConfigMap(configMap: any, warnings: EdgeUnitWarning[]): boolean {
  const data = dataOf(configMap);
  if (data.name) return true;
  warnings.push({
    source: "edgeunit.configmap",
    message: `Invalid EdgeUnit ConfigMap ${metadataOf(configMap).namespace || "blueedge-system"}/${metadataOf(configMap).name || "-"}: missing data.name`,
  });
  return false;
}

export async function collectEdgeUnitSources(warnings: EdgeUnitWarning[], options: { includeConfigMaps?: boolean; includeNodeGroups?: boolean } = {}): Promise<EdgeUnitSources> {
  const includeConfigMaps = options.includeConfigMaps !== false;
  const includeNodeGroups = options.includeNodeGroups !== false;
  const [edgeUnitConfigMaps, nodeGroupDetails, aux] = await Promise.all([
    includeConfigMaps ? getEdgeUnitConfigMaps(warnings) : Promise.resolve([]),
    includeNodeGroups ? collectNodeGroupDetails(warnings) : Promise.resolve({
      nodeGroups: [],
      nodeGroupError: null,
      nodeGroupByName: new Map<string, any>(),
    }),
    collectEdgeUnitAuxSources(warnings),
  ]);

  return {
    edgeUnitConfigMaps,
    ...nodeGroupDetails,
    aux,
  };
}

export async function getNodeGroupByName(name: string): Promise<any | null> {
  try {
    return await getJson(`/nodegroup/${encodeURIComponent(name)}`);
  } catch {
    return null;
  }
}

export async function resolveEdgeUnitReference(
  edgeUnitRef: string,
  warnings: EdgeUnitWarning[],
): Promise<{
  name: string;
  kubeEdgeVersion: string;
  accessAddresses: string[];
  ports: Partial<Record<"websocket" | "quic" | "https", string>>;
} | null> {
  const { edgeUnitConfigMaps } = await collectEdgeUnitSources(warnings, { includeNodeGroups: false });
  const matchedConfigMap = edgeUnitConfigMaps.find((configMap) => edgeUnitConfigMapMatches(configMap, edgeUnitRef));
  if (matchedConfigMap && isValidEdgeUnitConfigMap(matchedConfigMap, warnings)) {
    const data = dataOf(matchedConfigMap);
    let accessAddresses: string[] = [];
    let ports: Partial<Record<"websocket" | "quic" | "https", string>> = {};
    try {
      const parsed = JSON.parse(data.accessAddresses || "[]");
      if (Array.isArray(parsed)) accessAddresses = parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {
      accessAddresses = [];
    }
    try {
      const parsed = JSON.parse(data.ports || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        ports = Object.fromEntries(["websocket", "quic", "https"]
          .map((key) => [key, String(parsed[key] || "").trim()])
          .filter(([, value]) => value)) as Partial<Record<"websocket" | "quic" | "https", string>>;
      }
    } catch {
      ports = {};
    }
    return {
      name: edgeUnitConfigMapName(matchedConfigMap),
      kubeEdgeVersion: data.kubeEdgeVersion || "",
      accessAddresses,
      ports,
    };
  }
  return null;
}

export function knownEdgeUnitNames(edgeUnitConfigMaps: any[], warnings: EdgeUnitWarning[]) {
  return new Set(edgeUnitConfigMaps.filter((item) => isValidEdgeUnitConfigMap(item, warnings)).map(edgeUnitConfigMapName));
}

export function nodeNames(nodes: any[]) {
  return new Set(nodes.map(nodeNameOf));
}
