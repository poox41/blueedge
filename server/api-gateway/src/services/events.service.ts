import { getK8sJson } from "../clients/k8s-client.js";
import type { LegacyEventItem } from "../types/events.js";
import { itemsOf } from "../utils/kubernetes.js";

export async function getLegacyEvents(namespace: string): Promise<{ items: LegacyEventItem[] }> {
  const path = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/events`
    : "/api/v1/events";
  const data = await getK8sJson(path);
  const events = itemsOf(data)
    .map((item) => ({
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
    }))
    .sort((a, b) => String(b.lastTimestamp).localeCompare(String(a.lastTimestamp)))
    .slice(0, 20);
  return { items: events };
}
