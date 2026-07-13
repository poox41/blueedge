import type { EdgeUnitWarning } from "../types/warnings.js";
import { getK8sJson } from "../clients/k8s-client.js";

export function warning(source: string, error: unknown, fallback: string, code = "unavailable"): EdgeUnitWarning {
  return { source, code, message: error instanceof Error ? error.message : fallback };
}

export function itemsOf(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export function metadataOf(value: any): Record<string, any> {
  return value?.metadata && typeof value.metadata === "object" ? value.metadata : {};
}

export function labelsOf(value: any): Record<string, string> {
  const labels = metadataOf(value).labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return {};
  return Object.fromEntries(Object.entries(labels).map(([key, item]) => [key, String(item)]));
}

export function annotationsOf(value: any): Record<string, string> {
  const annotations = metadataOf(value).annotations;
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) return {};
  return Object.fromEntries(Object.entries(annotations).map(([key, item]) => [key, String(item)]));
}

export function dataOf(value: any): Record<string, string> {
  const data = value?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, String(item)]));
}

export function eventView(item: any) {
  return {
    name: item?.metadata?.name || item?.name || "-",
    namespace: item?.metadata?.namespace || item?.namespace || "default",
    type: item?.type || "Normal",
    reason: item?.reason || "-",
    message: item?.message || "",
    involvedObject: {
      kind: item?.involvedObject?.kind || "-",
      name: item?.involvedObject?.name || "-",
    },
    count: item?.count || 1,
    lastTimestamp: item?.lastTimestamp || item?.eventTime || item?.metadata?.creationTimestamp || "",
  };
}

export async function getResourceEvents(namespace: string, kind: string, name: string, warnings: EdgeUnitWarning[]) {
  const path = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/events`
    : "/api/v1/events";
  const data = await getK8sJson(path).catch((error) => {
    warnings.push(warning("events", error, "events API is unavailable"));
    return null;
  });
  return itemsOf(data)
    .filter((item) => String(item?.involvedObject?.kind || "").toLowerCase() === kind.toLowerCase() && item?.involvedObject?.name === name)
    .map(eventView)
    .sort((a, b) => String(b.lastTimestamp).localeCompare(String(a.lastTimestamp)))
    .slice(0, 20);
}

export function podNamespace(pod: any): string {
  return String(metadataOf(pod).namespace || pod?.namespace || "default");
}

export function podName(pod: any): string {
  return String(metadataOf(pod).name || pod?.name || "");
}

export function podPhase(pod: any): string {
  return String(pod?.status?.phase || pod?.phase || "Unknown");
}

export function podIsRunning(pod: any): boolean {
  return podPhase(pod) === "Running";
}

export function podRestartCount(pod: any): number {
  const statuses = Array.isArray(pod?.status?.containerStatuses) ? pod.status.containerStatuses : [];
  return statuses.reduce((sum: number, item: any) => sum + Number(item?.restartCount || 0), 0);
}

export function podSummaryItem(pod: any) {
  const containers = Array.isArray(pod?.spec?.containers) ? pod.spec.containers : [];
  return {
    name: podName(pod),
    namespace: podNamespace(pod),
    status: podPhase(pod),
    nodeName: pod?.spec?.nodeName || "",
    podIP: pod?.status?.podIP || "",
    restartCount: podRestartCount(pod),
    images: containers.map((item: any) => item?.image).filter(Boolean),
    createdAt: metadataOf(pod).creationTimestamp || "",
  };
}

export function nodeNameOf(node: any): string {
  return String(metadataOf(node).name || node?.name || "");
}

export function nodeInternalIP(node: any): string {
  const addresses = Array.isArray(node?.status?.addresses) ? node.status.addresses : [];
  return addresses.find((item: any) => item?.type === "InternalIP")?.address || node?.internalIP || "";
}

export function isNodeReady(node: any): boolean {
  const flatStatus = String(node?.status || "").toLowerCase();
  if (flatStatus === "ready" || flatStatus === "true") return true;
  if (flatStatus === "notready" || flatStatus === "not ready" || flatStatus === "false") return false;

  const conditions = Array.isArray(node?.status?.conditions) ? node.status.conditions : [];
  return conditions.some((item: any) => item?.type === "Ready" && item?.status === "True");
}

export function normalizeNameList(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item : item?.name || item?.nodeName)
    .filter(Boolean)
    .map(String);
}

export function nodeGroupSelectorOf(nodeGroup: any): Record<string, string> {
  const selector =
    nodeGroup?.spec?.matchLabels ||
    nodeGroup?.spec?.nodeSelector ||
    nodeGroup?.spec?.selector?.matchLabels ||
    nodeGroup?.spec?.selector ||
    {};
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) return {};
  return Object.fromEntries(Object.entries(selector).map(([key, value]) => [key, String(value)]));
}

export function explicitNodeNamesOf(nodeGroup: any): string[] {
  return normalizeNameList(nodeGroup?.spec?.nodes || nodeGroup?.spec?.nodeNames);
}

export function nodeMatchesSelector(node: any, selector: Record<string, string>): boolean {
  const entries = Object.entries(selector);
  return entries.length > 0 && entries.every(([key, value]) => labelsOf(node)[key] === value);
}

export function nodeByName(nodes: any[], name: string): any | null {
  return nodes.find((node) => nodeNameOf(node) === name) || null;
}

export function workloadManifestOfEdgeApp(app: any): any {
  const manifests = app?.spec?.workloadTemplate?.manifests;
  if (Array.isArray(manifests) && manifests[0]) return manifests[0];
  return app?.spec?.workloadTemplate || null;
}

export function containedResourceRefs(app: any): Array<{ kind?: string; namespace?: string; name?: string }> {
  const value = annotationsOf(app)["apps.kubeedge.io/last-contained-resources"];
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function targetNodeGroupsOfEdgeApp(app: any): string[] {
  const targetNodeGroups = app?.spec?.workloadScope?.targetNodeGroups;
  if (!Array.isArray(targetNodeGroups)) return [];
  return targetNodeGroups.map((item: any) => String(typeof item === "string" ? item : item?.name || "")).filter(Boolean);
}

export function selectorOfWorkload(workload: any): Record<string, string> {
  const selector = workload?.spec?.selector?.matchLabels || workload?.spec?.template?.metadata?.labels || {};
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) return {};
  return Object.fromEntries(Object.entries(selector).map(([key, value]) => [key, String(value)]));
}

export function podMatchesSelector(pod: any, selector: Record<string, string>): boolean {
  const entries = Object.entries(selector);
  if (entries.length === 0) return false;
  const labels = labelsOf(pod);
  return entries.every(([key, value]) => labels[key] === value);
}

export function parseCpuToMillicores(value: unknown): number {
  if (typeof value !== "string") return 0;
  if (value.endsWith("n")) return Number(value.slice(0, -1)) / 1_000_000;
  if (value.endsWith("u")) return Number(value.slice(0, -1)) / 1_000;
  if (value.endsWith("m")) return Number(value.slice(0, -1));
  return Number(value) * 1000;
}

export function parseMemoryToBytes(value: unknown): number {
  if (typeof value !== "string") return 0;
  const match = value.match(/^([0-9.]+)([A-Za-z]*)$/);
  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = match[2];
  const factors: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    "": 1,
  };
  return amount * (factors[unit] || 1);
}
