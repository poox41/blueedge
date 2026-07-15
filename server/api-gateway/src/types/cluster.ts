export interface ConnectedClusterSummary {
  name: string;
  current: true;
  kubernetesVersion: string;
  nodeCount: number;
  source: "kubeadm-config";
}

export interface ConnectedClusterListResponse {
  items: ConnectedClusterSummary[];
}
