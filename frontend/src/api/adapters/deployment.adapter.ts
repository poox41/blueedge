import type { KubeResource, WorkloadView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace } from "./common";

function toNumber(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

function parseReady(raw: KubeResource): { available: number; replicas: number } | null {
  const ready = raw.ready || raw.pods || raw.podStatus;
  if (typeof ready !== "string") return null;

  const match = ready.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;

  return {
    available: Number(match[1]),
    replicas: Number(match[2]),
  };
}

export function normalizeDeployment(raw: KubeResource): WorkloadView {
  const ready = parseReady(raw);
  const replicas = toNumber(
    raw.spec?.replicas,
    raw.replicas,
    raw.desiredReplicas,
    raw.desired,
    ready?.replicas,
  );
  const availableReplicas = toNumber(
    raw.status?.availableReplicas,
    raw.status?.readyReplicas,
    raw.availableReplicas,
    raw.readyReplicas,
    raw.available,
    raw.readyNum,
    ready?.available,
  );
  const updatedReplicas = toNumber(raw.status?.updatedReplicas, raw.updatedReplicas, availableReplicas);

  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    ready: `${availableReplicas}/${replicas}`,
    replicas,
    availableReplicas,
    updatedReplicas,
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeDeploymentList(payload: unknown): WorkloadView[] {
  return asItems<KubeResource>(payload).map(normalizeDeployment);
}
