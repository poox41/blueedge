export type DeploymentAction = "start" | "stop" | "restart";

export interface DeploymentRevisionItem {
  revision: number;
  current: boolean;
  replicaSetName: string;
  createdAt: string;
  images: string[];
  replicas: number;
  availableReplicas: number;
  yaml: unknown;
}

export interface DeploymentAuditItem {
  manager: string;
  operation: string;
  apiVersion: string;
  subresource: string;
  time: string;
}

export interface DeploymentExecPayload {
  pod: string;
  container: string;
  command: string;
}
