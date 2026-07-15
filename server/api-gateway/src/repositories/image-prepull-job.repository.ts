import { requestK8sJson } from "../clients/k8s-client.js";

const imagePrePullJobPath = "/apis/operations.kubeedge.io/v1alpha2/imageprepulljobs";

export async function listImagePrePullJobs(): Promise<any[]> {
  const result = await requestK8sJson(imagePrePullJobPath);
  return Array.isArray(result?.items) ? result.items : [];
}

export async function getImagePrePullJob(name: string): Promise<any | null> {
  try {
    return await requestK8sJson(`${imagePrePullJobPath}/${encodeURIComponent(name)}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("failed: 404")) return null;
    throw error;
  }
}

export async function createImagePrePullJob(resource: any): Promise<any> {
  return requestK8sJson(imagePrePullJobPath, { method: "POST", body: resource });
}

export async function deleteImagePrePullJob(name: string): Promise<any> {
  return requestK8sJson(`${imagePrePullJobPath}/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function getImagePullSecret(namespace: string, name: string): Promise<any | null> {
  try {
    return await requestK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("failed: 404")) return null;
    throw error;
  }
}
