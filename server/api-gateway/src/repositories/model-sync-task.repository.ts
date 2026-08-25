import { requestK8sJson } from "../clients/k8s-client.js";

function collectionPath(namespace: string) {
  return `/apis/blueedge.io/v1alpha1/namespaces/${encodeURIComponent(namespace)}/modelsynctasks`;
}

export async function getModelSyncTask(namespace: string, name: string): Promise<any> {
  return requestK8sJson(`${collectionPath(namespace)}/${encodeURIComponent(name)}`);
}

export async function listModelSyncTasks(): Promise<any[]> {
  const result = await requestK8sJson("/apis/blueedge.io/v1alpha1/modelsynctasks");
  return Array.isArray(result?.items) ? result.items : [];
}

export async function updateModelSyncTaskStatus(task: any, status: any): Promise<any> {
  const namespace = String(task?.metadata?.namespace || "");
  const name = String(task?.metadata?.name || "");
  if (!namespace || !name) throw new Error("ModelSyncTask namespace and name are required");
  return requestK8sJson(`${collectionPath(namespace)}/${encodeURIComponent(name)}/status`, {
    method: "PUT",
    body: { ...task, status },
  });
}

export async function createModelSyncTask(namespace: string, resource: any): Promise<{ item: any; idempotent: boolean }> {
  try {
    return {
      item: await requestK8sJson(collectionPath(namespace), { method: "POST", body: resource }),
      idempotent: false,
    };
  } catch (error) {
    if (!/409|AlreadyExists/i.test(error instanceof Error ? error.message : "")) throw error;
    const existing = await getModelSyncTask(namespace, String(resource?.metadata?.name || ""));
    if (
      existing?.spec?.artifact?.contentVersion !== resource?.spec?.artifact?.contentVersion
      || existing?.spec?.deployment?.name !== resource?.spec?.deployment?.name
    ) {
      throw new Error("existing ModelSyncTask does not match the requested model content");
    }
    return { item: existing, idempotent: true };
  }
}
