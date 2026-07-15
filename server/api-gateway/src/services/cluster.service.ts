import { load } from "js-yaml";
import { getK8sJson } from "../clients/k8s-client.js";
import type { ConnectedClusterListResponse } from "../types/cluster.js";
import { itemsOf } from "../utils/kubernetes.js";

interface KubeadmClusterConfiguration {
  clusterName?: unknown;
  kubernetesVersion?: unknown;
}

export function parseKubeadmClusterConfiguration(value: string): { name: string; kubernetesVersion: string } {
  const parsed = load(value) as KubeadmClusterConfiguration | null;
  const name = typeof parsed?.clusterName === "string" ? parsed.clusterName.trim() : "";
  const kubernetesVersion = typeof parsed?.kubernetesVersion === "string" ? parsed.kubernetesVersion.trim() : "";
  if (!name) throw new Error("kubeadm-config does not contain clusterName");
  return { name, kubernetesVersion };
}

export async function listConnectedClusters(): Promise<ConnectedClusterListResponse> {
  const [kubeadmConfig, nodes, version] = await Promise.all([
    getK8sJson("/api/v1/namespaces/kube-system/configmaps/kubeadm-config"),
    getK8sJson("/api/v1/nodes"),
    getK8sJson("/version"),
  ]);
  const rawConfiguration = kubeadmConfig?.data?.ClusterConfiguration;
  if (typeof rawConfiguration !== "string" || !rawConfiguration.trim()) {
    throw new Error("kube-system/kubeadm-config does not contain ClusterConfiguration");
  }
  const cluster = parseKubeadmClusterConfiguration(rawConfiguration);
  return {
    items: [{
      name: cluster.name,
      current: true,
      kubernetesVersion: cluster.kubernetesVersion || String(version?.gitVersion || ""),
      nodeCount: itemsOf(nodes).length,
      source: "kubeadm-config",
    }],
  };
}
