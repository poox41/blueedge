export type BatchTaskType = "nodeUpgrade" | "imagePreheat" | "batchWorkload";

export interface BatchWorkloadPlanContainer {
  name: string;
  image: string;
  imagePullPolicy?: "Always" | "IfNotPresent" | "Never";
  command?: string[];
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  resources?: {
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  lifecycle?: { postStart?: string; preStop?: string };
  healthChecks?: { startup?: boolean; readiness?: boolean; liveness?: boolean };
  securityContext?: {
    privileged?: boolean;
    runAsUser?: number;
    runAsGroup?: number;
    readOnlyRootFilesystem?: boolean;
    allowPrivilegeEscalation?: boolean;
  };
  volumes?: Array<{ name: string; type: string; mountPath: string; source?: string }>;
}

export interface BatchWorkloadPlan {
  namespace: string;
  name: string;
  targetGroups: string[];
  replicas: number;
  workloadType: "Deployment";
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  podTemplate: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    containers: BatchWorkloadPlanContainer[];
    network?: { type: "none" | "portmap" | "host"; ports?: Array<{ containerName: string; containerPort: number; hostPort?: number }> };
    terminationGracePeriodSeconds?: number;
  };
  strategy?: {
    type: "RollingUpdate" | "Recreate";
    maxUnavailable?: string;
    maxSurge?: string;
    revisionHistoryLimit?: number;
    minReadySeconds?: number;
    progressDeadlineSeconds?: number;
  };
}
