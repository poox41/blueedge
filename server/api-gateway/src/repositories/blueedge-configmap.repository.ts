import { requestK8sJson } from "../clients/k8s-client.js";
import { config } from "../config.js";
import { itemsOf } from "../utils/kubernetes.js";

export const blueedgeResourceLabel = "blueedge.io/resource";
export const edgeUnitResourceValue = "edgeunit";
export const accessConfigResourceValue = "access-config";
export const batchTaskResourceValue = "batch-task";

export function blueedgeNamespace() {
  return config.blueedgeSystemNamespace;
}

function configMapPath(name?: string) {
  const base = `/api/v1/namespaces/${encodeURIComponent(blueedgeNamespace())}/configmaps`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

export async function listByResourceLabel(resourceType: string): Promise<any[]> {
  const selector = encodeURIComponent(`${blueedgeResourceLabel}=${resourceType}`);
  const data = await requestK8sJson(`${configMapPath()}?labelSelector=${selector}`);
  return itemsOf(data);
}

export async function getByName(configMapName: string): Promise<any> {
  return requestK8sJson(configMapPath(configMapName));
}

export async function ensureNamespace() {
  await requestK8sJson(`/api/v1/namespaces/${encodeURIComponent(blueedgeNamespace())}`).catch(async () => {
    await requestK8sJson("/api/v1/namespaces", {
      method: "POST",
      body: {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name: blueedgeNamespace() },
      },
    });
  });
}
export async function create(resource: any): Promise<any> {
  return requestK8sJson(configMapPath(), {
    method: "POST",
    body: resource,
  });
}

export async function update(configMapName: string, resource: any): Promise<any> {
  return requestK8sJson(configMapPath(configMapName), {
    method: "PUT",
    body: resource,
  });
}

export async function remove(configMapName: string): Promise<any> {
  return requestK8sJson(configMapPath(configMapName), {
    method: "DELETE",
  });
}
