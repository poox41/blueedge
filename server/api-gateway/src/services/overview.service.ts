import { getJson } from "../clients/bff-client.js";
import type { LegacyOverview } from "../types/overview.js";
import { itemsOf } from "../utils/kubernetes.js";

export async function getLegacyOverview(): Promise<LegacyOverview> {
  const [nodesRaw, deploymentsRaw, devicesRaw, rulesRaw] = await Promise.allSettled([
    getJson("/node"),
    getJson("/deployment"),
    getJson("/device"),
    getJson("/rule"),
  ]);
  const nodes = nodesRaw.status === "fulfilled" ? itemsOf(nodesRaw.value) : [];
  const deployments = deploymentsRaw.status === "fulfilled" ? itemsOf(deploymentsRaw.value) : [];
  const devices = devicesRaw.status === "fulfilled" ? itemsOf(devicesRaw.value) : [];
  const rules = rulesRaw.status === "fulfilled" ? itemsOf(rulesRaw.value) : [];
  const readyNodes = nodes.filter((node) => {
    const conditions = node?.status?.conditions || [];
    return conditions.some((item: any) => item.type === "Ready" && item.status === "True");
  });
  const edgeNodes = nodes.filter((node) => {
    const labels = node?.metadata?.labels || {};
    return Object.keys(labels).some((key) => key.includes("edge") || key.includes("kubeedge"));
  });
  const runningDeployments = deployments.filter((item) => Number(item?.status?.availableReplicas || 0) > 0);
  return {
    nodes: { total: nodes.length, ready: readyNodes.length, edge: edgeNodes.length },
    workloads: { deployments: deployments.length, running: runningDeployments.length },
    devices: { total: devices.length, online: 0 },
    rules: { total: rules.length },
  };
}
