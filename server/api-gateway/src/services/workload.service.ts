import { getK8sJson, getK8sText } from "../clients/k8s-client.js";

export async function listLegacyPods(namespace: string) {
  const path = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`
    : "/api/v1/pods";
  return getK8sJson(path);
}

export async function getLegacyPodLogs(namespace: string, name: string, tailLines: string) {
  const path =
    `/api/v1/namespaces/${encodeURIComponent(namespace)}` +
    `/pods/${encodeURIComponent(name)}/log?tailLines=${encodeURIComponent(tailLines)}&timestamps=true`;
  return getK8sText(path);
}
