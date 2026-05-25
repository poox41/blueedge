import type { KubeResource, WorkloadView } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace } from "./common";

export function normalizeDeployment(raw: KubeResource): WorkloadView {
  const replicas = Number(raw.spec?.replicas || 0);
  const availableReplicas = Number(raw.status?.availableReplicas || 0);
  const updatedReplicas = Number(raw.status?.updatedReplicas || 0);

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
