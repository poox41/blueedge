import { getJson } from "../clients/bff-client.js";
import { getK8sJson, getK8sText } from "../clients/k8s-client.js";
import type { ObservabilityKind, ObservabilityQuery } from "../types/observability.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  containedResourceRefs,
  getResourceEvents,
  itemsOf,
  labelsOf,
  metadataOf,
  nodeInternalIP,
  nodeNameOf,
  parseCpuToMillicores,
  parseMemoryToBytes,
  podName,
  podNamespace,
  podSummaryItem,
  selectorOfWorkload,
  warning,
  workloadManifestOfEdgeApp,
  isNodeReady,
} from "../utils/kubernetes.js";

export const observabilityKinds = new Set(["node", "pod", "deployment", "edgeapplication", "device"]);
const observabilityMaxEvents = 50;
const observabilityMaxLogPods = 5;

function boolQuery(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return fallback;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function optionalPositiveIntQuery(value: unknown): number | null {
  if (value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function podContainers(pod: any): string[] {
  const containers = [
    ...(Array.isArray(pod?.spec?.containers) ? pod.spec.containers : []),
    ...(Array.isArray(pod?.spec?.initContainers) ? pod.spec.initContainers : []),
  ];
  return containers.map((item: any) => String(item?.name || "")).filter(Boolean);
}

function emptyMetrics(reason = "not_configured") {
  return {
    available: false,
    reason,
    scope: "none",
    cpuUsage: "",
    memoryUsage: "",
    containers: [],
    pods: [],
  };
}

function metricsFromPodMetric(metric: any) {
  const containers = Array.isArray(metric?.containers) ? metric.containers : [];
  const normalized = containers.map((container: any) => ({
    name: container?.name || "",
    cpuUsage: Math.round(parseCpuToMillicores(container?.usage?.cpu)),
    memoryUsage: Math.round(parseMemoryToBytes(container?.usage?.memory)),
  }));
  return {
    available: true,
    scope: "pod",
    cpuUsage: normalized.reduce((sum: number, item: any) => sum + item.cpuUsage, 0),
    memoryUsage: normalized.reduce((sum: number, item: any) => sum + item.memoryUsage, 0),
    containers: normalized,
    pods: [],
  };
}

export async function getPodSummaryMetrics(namespace: string, name: string, warnings: EdgeUnitWarning[]) {
  const data = await getK8sJson(`/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`).catch(() => {
    warnings.push(podMetricsUnavailableWarning(name));
    return null;
  });
  if (!data) return { available: false, containers: [] };
  return {
    available: true,
    containers: (Array.isArray(data?.containers) ? data.containers : []).map((container: any) => ({
      name: container?.name || "",
      cpuUsage: Math.round(parseCpuToMillicores(container?.usage?.cpu)),
      memoryUsage: Math.round(parseMemoryToBytes(container?.usage?.memory)),
    })),
  };
}

export async function getPodSummaryRecentLogs(namespace: string, name: string, container: string, tailLines: string, warnings: EdgeUnitWarning[]) {
  return getK8sText(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log?tailLines=${encodeURIComponent(tailLines)}&timestamps=true${container ? `&container=${encodeURIComponent(container)}` : ""}`)
    .then((content) => ({ available: true, container, content }))
    .catch((error) => {
      warnings.push(warning("logs", error, "pod logs unavailable"));
      return { available: false, container, content: "" };
    });
}

async function getPodMetricsRaw(namespace: string, name: string, warnings: EdgeUnitWarning[]) {
  const data = await getK8sJson(`/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`).catch(() => {
    warnings.push(podMetricsUnavailableWarning(name));
    return null;
  });
  return data;
}

async function getPodMetricsView(namespace: string, name: string, warnings: EdgeUnitWarning[]) {
  const data = await getPodMetricsRaw(namespace, name, warnings);
  return data ? metricsFromPodMetric(data) : emptyMetrics("metrics_unavailable");
}

async function aggregatePodMetrics(pods: any[], warnings: EdgeUnitWarning[]) {
  if (pods.length === 0) return emptyMetrics("no_pods");
  const metrics = await Promise.all(pods.map((pod) => getPodMetricsRaw(podNamespace(pod), podName(pod), warnings)));
  const podItems = metrics
    .map((metric, index) => metric ? { pod: pods[index], metric } : null)
    .filter(Boolean) as Array<{ pod: any; metric: any }>;
  if (podItems.length === 0) return emptyMetrics("metrics_unavailable");
  const podsView = podItems.map(({ pod, metric }) => {
    const view = metricsFromPodMetric(metric);
    return {
      name: podName(pod),
      namespace: podNamespace(pod),
      cpuUsage: view.cpuUsage,
      memoryUsage: view.memoryUsage,
      containers: view.containers,
    };
  });
  return {
    available: true,
    scope: "pods",
    cpuUsage: podsView.reduce((sum, item) => sum + item.cpuUsage, 0),
    memoryUsage: podsView.reduce((sum, item) => sum + item.memoryUsage, 0),
    containers: [],
    pods: podsView,
  };
}

async function getResourceEventsLimited(namespace: string, kind: string, name: string, warnings: EdgeUnitWarning[]) {
  const items = await getResourceEvents(namespace, kind, name, warnings);
  return items.slice(0, observabilityMaxEvents);
}

export const getSummaryResourceEvents = getResourceEvents;

function labelsMatchSelector(labels: Record<string, string>, selector: Record<string, string>) {
  const entries = Object.entries(selector);
  return entries.length > 0 && entries.every(([key, value]) => labels[key] === value);
}

async function podsForDeployment(deployment: any, warnings: EdgeUnitWarning[]) {
  const namespace = String(metadataOf(deployment).namespace || "default");
  const data = await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`).catch((error) => {
    warnings.push(warning("pods", error, "pod list unavailable"));
    return null;
  });
  const selector = selectorOfWorkload(deployment);
  return itemsOf(data).filter((pod) => labelsMatchSelector(labelsOf(pod), selector));
}

async function deploymentForName(namespace: string, name: string) {
  return getK8sJson(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`);
}

async function edgeApplicationForName(namespace: string, name: string) {
  return getJson(`/edgeapplication/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
}

async function podsForEdgeApplication(app: any, warnings: EdgeUnitWarning[]) {
  const namespace = String(metadataOf(app).namespace || app?.namespace || "default");
  const containedRefs = containedResourceRefs(app);
  const deployments: any[] = [];
  for (const ref of containedRefs.filter((item) => String(item.kind || "").toLowerCase() === "deployment")) {
    const deployment = await deploymentForName(ref.namespace || namespace, String(ref.name || "")).catch((error) => {
      warnings.push(warning("deployment", error, "contained deployment unavailable"));
      return null;
    });
    if (deployment) deployments.push(deployment);
  }
  const manifest = workloadManifestOfEdgeApp(app);
  if (manifest && String(manifest.kind || "").toLowerCase() === "deployment") deployments.push(manifest);

  const pods = await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`).then(itemsOf).catch((error) => {
    warnings.push(warning("pods", error, "pod list unavailable"));
    return [];
  });
  const selectors = deployments.map(selectorOfWorkload).filter((selector) => Object.keys(selector).length > 0);
  if (selectors.length === 0) {
    warnings.push({ source: "association", code: "unavailable", message: "EdgeApplication related pods cannot be resolved" });
    return { deployments, pods: [] };
  }
  return { deployments, pods: pods.filter((pod) => selectors.some((selector) => labelsMatchSelector(labelsOf(pod), selector))) };
}

async function getObservabilityResource(kind: string, namespace: string, name: string) {
  if (kind === "node") return getK8sJson(`/api/v1/nodes/${encodeURIComponent(name)}`);
  if (kind === "pod") return getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`);
  if (kind === "deployment") return deploymentForName(namespace, name);
  if (kind === "edgeapplication") return edgeApplicationForName(namespace, name);
  if (kind === "device") return getK8sJson(`/apis/devices.kubeedge.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/devices/${encodeURIComponent(name)}`);
  throw new Error(`Unsupported observability kind: ${kind}`);
}

async function relatedPodsForObservability(kind: string, namespace: string, resource: any, warnings: EdgeUnitWarning[]) {
  if (kind === "pod") return [resource];
  if (kind === "deployment") return podsForDeployment(resource, warnings);
  if (kind === "edgeapplication") return (await podsForEdgeApplication(resource, warnings)).pods;
  return [];
}

function nodeSummaryStatus(node: any): string {
  return isNodeReady(node) ? "ready" : "notReady";
}

function relatedResourcesView(kind: string, resource: any, pods: any[]) {
  return {
    pods: pods.map(podSummaryItem),
    node: kind === "node" ? { name: nodeNameOf(resource), status: nodeSummaryStatus(resource), internalIP: nodeInternalIP(resource) } : null,
    deployment: kind === "deployment" ? { namespace: String(metadataOf(resource).namespace || "default"), name: String(metadataOf(resource).name || "") } : null,
    edgeApplication: kind === "edgeapplication" ? { namespace: String(metadataOf(resource).namespace || resource?.namespace || "default"), name: String(metadataOf(resource).name || resource?.name || "") } : null,
  };
}

export function nodeMetricsUnavailableWarning(name: string): EdgeUnitWarning {
  return {
    source: "metrics.node",
    code: "metrics_unavailable",
    message: `节点 ${name} 的 CPU、内存监控指标暂不可用，不影响节点健康状态和其他操作`,
  };
}

export function podMetricsUnavailableWarning(name: string): EdgeUnitWarning {
  return {
    source: "metrics.pod",
    code: "metrics_unavailable",
    message: `Pod ${name} 尚未运行或指标尚未采集，暂无监控数据`,
  };
}

async function getNodeMetricsView(name: string, warnings: EdgeUnitWarning[]) {
  const data = await getK8sJson(`/apis/metrics.k8s.io/v1beta1/nodes/${encodeURIComponent(name)}`).catch(() => {
    warnings.push(nodeMetricsUnavailableWarning(name));
    return null;
  });
  if (!data) return { available: false, cpuUsage: null, memoryUsage: null };
  return {
    available: true,
    cpuUsage: Math.round(parseCpuToMillicores(data?.usage?.cpu)),
    memoryUsage: Math.round(parseMemoryToBytes(data?.usage?.memory)),
  };
}

export const getNodeSummaryMetrics = getNodeMetricsView;

async function metricsForObservability(kind: string, namespace: string, name: string, pods: any[], warnings: EdgeUnitWarning[]) {
  if (kind === "node") {
    const metrics = await getNodeMetricsView(name, warnings);
    return metrics.available
      ? { available: true, scope: "node", cpuUsage: metrics.cpuUsage, memoryUsage: metrics.memoryUsage, containers: [], pods: [] }
      : emptyMetrics("metrics_unavailable");
  }
  if (kind === "pod") return getPodMetricsView(namespace, name, warnings);
  if (kind === "deployment" || kind === "edgeapplication") return aggregatePodMetrics(pods, warnings);
  if (kind === "device") return emptyMetrics("device_metrics_not_configured");
  return emptyMetrics();
}

async function eventsForObservability(kind: string, namespace: string, name: string, pods: any[], warnings: EdgeUnitWarning[]) {
  if (kind === "node") {
    return { available: true, items: await getResourceEventsLimited("", "Node", name, warnings) };
  }
  const eventKind = kind === "edgeapplication" ? "EdgeApplication" : kind === "device" ? "Device" : kind[0].toUpperCase() + kind.slice(1);
  const items = await getResourceEventsLimited(namespace, eventKind, name, warnings);
  if (kind === "deployment" || kind === "edgeapplication") {
    const podEvents = (await Promise.all(pods.slice(0, observabilityMaxLogPods).map((pod) => getResourceEventsLimited(podNamespace(pod), "Pod", podName(pod), warnings)))).flat();
    return { available: true, items: [...items, ...podEvents].slice(0, observabilityMaxEvents) };
  }
  return { available: true, items };
}

function podLogPath(pod: any, options: { container?: string; tailLines: number; sinceSeconds: number | null; previous: boolean }) {
  const namespace = podNamespace(pod);
  const name = podName(pod);
  const params = new URLSearchParams({ tailLines: String(options.tailLines), timestamps: "true" });
  if (options.container) params.set("container", options.container);
  if (options.sinceSeconds) params.set("sinceSeconds", String(options.sinceSeconds));
  if (options.previous) params.set("previous", "true");
  return `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}/log?${params.toString()}`;
}

async function logsForPods(kind: string, name: string, pods: any[], query: ObservabilityQuery, warnings: EdgeUnitWarning[]) {
  const requestedPod = typeof query.pod === "string" ? query.pod : "";
  const container = typeof query.container === "string" && query.container.trim() ? query.container.trim() : "";
  const tailLines = intQuery(query.tailLines, 100, 1, 1000);
  const sinceSeconds = optionalPositiveIntQuery(query.sinceSeconds);
  const previous = boolQuery(query.previous, false);
  let targets = pods;
  if (requestedPod) targets = targets.filter((pod) => podName(pod) === requestedPod);
  targets = targets.slice(0, observabilityMaxLogPods);

  const results = await Promise.all(targets.map(async (pod) => {
    const containers = podContainers(pod);
    const selectedContainer = container || containers[0] || "";
    if (container && !containers.includes(container)) {
      warnings.push({ source: "logs", code: "invalid_container", message: `Container ${container} does not belong to Pod ${podName(pod)}` });
      return { podName: podName(pod), container, available: false, content: "", truncated: false, reason: "invalid_container" };
    }
    const content = await getK8sText(podLogPath(pod, { container: selectedContainer, tailLines, sinceSeconds, previous })).catch((error) => {
      warnings.push(warning("logs", error, `Pod ${podName(pod)} logs unavailable`));
      return null;
    });
    return {
      podName: podName(pod),
      container: selectedContainer,
      available: content !== null,
      content: content || "",
      truncated: false,
    };
  }));

  return {
    kind,
    name,
    pods: results,
  };
}

function logsNotAvailable(reason: string) {
  return { available: false, reason, pods: [] };
}

export async function getObservabilitySummary(kind: ObservabilityKind, namespace: string, name: string, query: ObservabilityQuery) {
  const warnings: EdgeUnitWarning[] = [];
  const includeMetrics = boolQuery(query.includeMetrics, true);
  const includeEvents = boolQuery(query.includeEvents, true);
  const includeLogs = boolQuery(query.includeLogs, false);
  const resource = await getObservabilityResource(kind, namespace, name);
  const pods = await relatedPodsForObservability(kind, namespace, resource, warnings);
  const [metrics, events, logs] = await Promise.all([
    includeMetrics ? metricsForObservability(kind, namespace, name, pods, warnings) : Promise.resolve(emptyMetrics("not_requested")),
    includeEvents ? eventsForObservability(kind, namespace, name, pods, warnings) : Promise.resolve({ available: false, reason: "not_requested", items: [] }),
    includeLogs
      ? logsForPods(kind, name, pods, query, warnings).then((item) => ({ available: item.pods.some((pod) => pod.available), reason: item.pods.length > 0 ? "" : "no_pods", pods: item.pods }))
      : Promise.resolve(kind === "node" ? logsNotAvailable("node_logs_not_configured") : kind === "device" ? logsNotAvailable("device_logs_not_configured") : logsNotAvailable("not_requested")),
  ]);

  return {
    item: {
      kind,
      namespace: namespace || "_",
      name,
      metrics,
      events,
      logs,
      relatedResources: relatedResourcesView(kind, resource, pods),
      stale: false,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function getObservabilityLogs(kind: ObservabilityKind, namespace: string, name: string, query: ObservabilityQuery) {
  const warnings: EdgeUnitWarning[] = [];
  if (kind === "node") {
    return { item: { kind, namespace: "_", name, pods: [], available: false, reason: "node_logs_not_configured" }, warnings };
  }
  if (kind === "device") {
    return { item: { kind, namespace, name, pods: [], available: false, reason: "device_logs_not_configured" }, warnings };
  }

  const resource = await getObservabilityResource(kind, namespace, name);
  const pods = await relatedPodsForObservability(kind, namespace, resource, warnings);
  const item = await logsForPods(kind, name, pods, query, warnings);
  return { item: { ...item, namespace }, ...(warnings.length > 0 ? { warnings } : {}) };
}
