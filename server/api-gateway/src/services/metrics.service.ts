import { getK8sJson } from "../clients/k8s-client.js";
import type { ClusterMetricsSample } from "../types/metrics.js";
import { itemsOf, parseCpuToMillicores, parseMemoryToBytes } from "../utils/kubernetes.js";

const clusterMetricsHistory: ClusterMetricsSample[] = [];
const metricsHistoryMaxAgeMs = 6 * 60 * 60 * 1000;
const metricsHistoryMaxSamples = 120;

function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.round((used / total) * 1000) / 10;
}

async function collectClusterMetrics(): Promise<ClusterMetricsSample> {
  const [metricsRaw, nodesRaw] = await Promise.all([
    getK8sJson("/apis/metrics.k8s.io/v1beta1/nodes"),
    getK8sJson("/api/v1/nodes"),
  ]);
  const metricItems = itemsOf(metricsRaw);
  const nodeItems = itemsOf(nodesRaw);
  const cpuUsedMillicores = metricItems.reduce((sum, item) => sum + parseCpuToMillicores(item?.usage?.cpu), 0);
  const memoryUsedBytes = metricItems.reduce((sum, item) => sum + parseMemoryToBytes(item?.usage?.memory), 0);
  const cpuCapacityMillicores = nodeItems.reduce((sum, item) => sum + parseCpuToMillicores(item?.status?.capacity?.cpu), 0);
  const memoryCapacityBytes = nodeItems.reduce((sum, item) => sum + parseMemoryToBytes(item?.status?.capacity?.memory), 0);
  return {
    timestamp: new Date().toISOString(),
    cpu: {
      usedMillicores: Math.round(cpuUsedMillicores),
      capacityMillicores: Math.round(cpuCapacityMillicores),
      percent: percent(cpuUsedMillicores, cpuCapacityMillicores),
    },
    memory: {
      usedBytes: Math.round(memoryUsedBytes),
      capacityBytes: Math.round(memoryCapacityBytes),
      percent: percent(memoryUsedBytes, memoryCapacityBytes),
    },
    source: "metrics.k8s.io/v1beta1",
  };
}

function rememberClusterMetrics(sample: ClusterMetricsSample) {
  const last = clusterMetricsHistory[clusterMetricsHistory.length - 1];
  if (!last || new Date(sample.timestamp).getTime() - new Date(last.timestamp).getTime() >= 15_000) {
    clusterMetricsHistory.push(sample);
  } else {
    clusterMetricsHistory[clusterMetricsHistory.length - 1] = sample;
  }
  const minTimestamp = Date.now() - metricsHistoryMaxAgeMs;
  while (
    clusterMetricsHistory.length > metricsHistoryMaxSamples ||
    (clusterMetricsHistory[0] && new Date(clusterMetricsHistory[0].timestamp).getTime() < minTimestamp)
  ) {
    clusterMetricsHistory.shift();
  }
}

export async function getClusterMetrics() {
  const sample = await collectClusterMetrics();
  rememberClusterMetrics(sample);
  return sample;
}

export async function getClusterMetricsHistory() {
  try {
    const sample = await collectClusterMetrics();
    rememberClusterMetrics(sample);
    return {
      status: 200,
      body: {
        items: clusterMetricsHistory,
        source: sample.source,
        retention: {
          maxAgeSeconds: Math.round(metricsHistoryMaxAgeMs / 1000),
          maxSamples: metricsHistoryMaxSamples,
        },
      },
    };
  } catch (error) {
    if (clusterMetricsHistory.length > 0) {
      return {
        status: 200,
        body: {
          items: clusterMetricsHistory,
          source: clusterMetricsHistory[clusterMetricsHistory.length - 1].source,
          stale: true,
        },
      };
    }
    throw error;
  }
}

export async function getNodeMetrics() {
  const [metricsRaw, nodesRaw] = await Promise.all([
    getK8sJson("/apis/metrics.k8s.io/v1beta1/nodes"),
    getK8sJson("/api/v1/nodes"),
  ]);
  const metricItems = itemsOf(metricsRaw);
  const capacityByName = new Map(
    itemsOf(nodesRaw).map((node) => [
      node?.metadata?.name,
      {
        cpuMillicores: parseCpuToMillicores(node?.status?.capacity?.cpu),
        memoryBytes: parseMemoryToBytes(node?.status?.capacity?.memory),
      },
    ]),
  );
  return {
    items: metricItems.map((item) => {
      const name = item?.metadata?.name || item?.name;
      const capacity = capacityByName.get(name) || { cpuMillicores: 0, memoryBytes: 0 };
      const cpuMillicores = parseCpuToMillicores(item?.usage?.cpu);
      const memoryBytes = parseMemoryToBytes(item?.usage?.memory);
      return {
        name,
        cpuMillicores: Math.round(cpuMillicores),
        memoryBytes: Math.round(memoryBytes),
        cpuPercent: percent(cpuMillicores, capacity.cpuMillicores),
        memoryPercent: percent(memoryBytes, capacity.memoryBytes),
      };
    }),
  };
}

export async function getPodMetrics(namespace: string) {
  const path = namespace
    ? `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods`
    : "/apis/metrics.k8s.io/v1beta1/pods";
  const data = await getK8sJson(path);
  return {
    items: itemsOf(data).map((item) => {
      const containers = Array.isArray(item?.containers) ? item.containers : [];
      const cpuMillicores = containers.reduce((sum: number, container: any) => sum + parseCpuToMillicores(container?.usage?.cpu), 0);
      const memoryBytes = containers.reduce((sum: number, container: any) => sum + parseMemoryToBytes(container?.usage?.memory), 0);
      return {
        name: item?.metadata?.name || item?.name,
        namespace: item?.metadata?.namespace || item?.namespace,
        cpuMillicores: Math.round(cpuMillicores),
        memoryBytes: Math.round(memoryBytes),
      };
    }),
  };
}
