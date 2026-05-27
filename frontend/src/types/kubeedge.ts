export interface KubeObjectMeta {
  name?: string;
  namespace?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

export interface KubeList<T> {
  items?: T[];
  [key: string]: unknown;
}

export interface KubeResource {
  apiVersion?: string;
  kind?: string;
  metadata?: KubeObjectMeta;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EdgeNodeView {
  name: string;
  status: "Ready" | "NotReady" | "Unknown";
  role: "cloud" | "edge" | "unknown";
  internalIP: string;
  osImage: string;
  kubeletVersion: string;
  createdAt: string;
  raw: KubeResource;
}

export interface WorkloadView {
  name: string;
  namespace: string;
  ready: string;
  replicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  createdAt: string;
  raw: KubeResource;
}

export interface DeviceModelView {
  name: string;
  namespace: string;
  propertiesCount: number;
  createdAt: string;
  raw: KubeResource;
}

export interface DeviceView {
  name: string;
  namespace: string;
  model: string;
  nodeName: string;
  status: string;
  createdAt: string;
  raw: KubeResource;
}

export interface RuleView {
  name: string;
  namespace: string;
  source: string;
  target: string;
  sourceResource?: string;
  targetResource?: string;
  createdAt: string;
  raw: KubeResource;
}

export interface RuleEndpointView {
  name: string;
  namespace: string;
  type: string;
  targetResource: string;
  createdAt: string;
  raw: KubeResource;
}

export interface ServiceView {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  externalIP: string;
  ports: string;
  createdAt: string;
  raw: KubeResource;
}
