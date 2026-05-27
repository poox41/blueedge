import { gatewayRequest } from "@/api/request";
import { asItems } from "@/api/adapters/common";
import type { KubeResource } from "@/types/kubeedge";

export async function listPersistentVolumes(): Promise<KubeResource[]> {
  const res = await gatewayRequest<unknown>("/storage/persistentvolumes");
  return asItems<KubeResource>(res.data);
}

export async function listPersistentVolumeClaims(namespace?: string): Promise<KubeResource[]> {
  const res = await gatewayRequest<unknown>("/storage/persistentvolumeclaims", {
    params: { namespace },
  });
  return asItems<KubeResource>(res.data);
}
