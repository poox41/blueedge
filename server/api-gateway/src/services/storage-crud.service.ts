import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import type { StorageCrudPayload } from "../types/storage-crud.js";

export function listPersistentVolumes() {
  return getK8sJson("/api/v1/persistentvolumes");
}

export function createPersistentVolume(body: StorageCrudPayload) {
  return requestK8sJson("/api/v1/persistentvolumes", { method: "POST", body });
}

export async function deletePersistentVolume(name: string) {
  await requestK8sJson(`/api/v1/persistentvolumes/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function listPersistentVolumeClaims(namespace: string) {
  const path = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`
    : "/api/v1/persistentvolumeclaims";
  return getK8sJson(path);
}

export function createPersistentVolumeClaim(body: StorageCrudPayload) {
  const namespace = body?.metadata?.namespace || "default";
  return requestK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`, {
    method: "POST",
    body,
  });
}

export async function deletePersistentVolumeClaim(namespace: string, name: string) {
  await requestK8sJson(
    `/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
}
