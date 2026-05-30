import { gatewayRequest } from "@/api/request";
import { asItems } from "@/api/adapters/common";
import type { KubeResource } from "@/types/kubeedge";

export async function listPersistentVolumes(): Promise<KubeResource[]> {
  const res = await gatewayRequest<unknown>("/storage/persistentvolumes");
  return asItems<KubeResource>(res.data);
}

export async function createPersistentVolume(resource: KubeResource): Promise<KubeResource> {
  const res = await gatewayRequest<KubeResource, KubeResource>("/storage/persistentvolumes", {
    method: "POST",
    body: resource,
  });
  return res.data;
}

export async function deletePersistentVolume(name: string): Promise<void> {
  await gatewayRequest(`/storage/persistentvolumes/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export async function listPersistentVolumeClaims(namespace?: string): Promise<KubeResource[]> {
  const res = await gatewayRequest<unknown>("/storage/persistentvolumeclaims", {
    params: { namespace },
  });
  return asItems<KubeResource>(res.data);
}

export async function createPersistentVolumeClaim(resource: KubeResource): Promise<KubeResource> {
  const res = await gatewayRequest<KubeResource, KubeResource>("/storage/persistentvolumeclaims", {
    method: "POST",
    body: resource,
  });
  return res.data;
}

export async function deletePersistentVolumeClaim(namespace: string, name: string): Promise<void> {
  await gatewayRequest(
    `/storage/persistentvolumeclaims/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}
