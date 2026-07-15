import * as yaml from "js-yaml";
import { requestK8sJson } from "../clients/k8s-client.js";
import { dataOf } from "../utils/kubernetes.js";

const nodeUpgradeJobPath = "/apis/operations.kubeedge.io/v1alpha2/nodeupgradejobs";

export async function listNodeUpgradeJobs(): Promise<any[]> {
  const result = await requestK8sJson(nodeUpgradeJobPath);
  return Array.isArray(result?.items) ? result.items : [];
}

export async function getNodeUpgradeJob(name: string): Promise<any | null> {
  try {
    return await requestK8sJson(`${nodeUpgradeJobPath}/${encodeURIComponent(name)}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("failed: 404")) return null;
    throw error;
  }
}

export async function createNodeUpgradeJob(resource: any): Promise<any> {
  return requestK8sJson(nodeUpgradeJobPath, { method: "POST", body: resource });
}

export async function deleteNodeUpgradeJob(name: string): Promise<any> {
  return requestK8sJson(`${nodeUpgradeJobPath}/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function cloudTaskManagerEnabled(): Promise<boolean> {
  const configMap = await requestK8sJson("/api/v1/namespaces/kubeedge/configmaps/cloudcore");
  const raw = Object.values(dataOf(configMap)).find((value) => value.includes("kind: CloudCore"));
  if (!raw) return false;
  const config = yaml.load(raw) as any;
  return config?.modules?.taskManager?.enable === true;
}
