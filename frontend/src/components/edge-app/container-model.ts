export type EnvValueSource = "value" | "configMapKeyRef" | "secretKeyRef";

export interface EnvItemForm {
  id: string;
  name: string;
  source: EnvValueSource;
  value: string;
  resourceName: string;
  key: string;
}

export interface EnvFromForm {
  id: string;
  source: "configMapRef" | "secretRef";
  name: string;
  prefix: string;
}

export interface VolumeMountForm {
  id: string;
  name: string;
  mountPath: string;
  subPath: string;
  subPathExpr: string;
  readOnly: boolean;
}

export interface ContainerPortForm {
  id: string;
  name: string;
  containerPort: string;
  hostPort: string;
  hostIP: string;
  protocol: "TCP" | "UDP" | "SCTP";
}

export type ProbeType = "httpGet" | "tcpSocket" | "exec";

export interface ProbeForm {
  enabled: boolean;
  type: ProbeType;
  path: string;
  host: string;
  port: string;
  scheme: "HTTP" | "HTTPS";
  command: string[];
  initialDelaySeconds: string;
  periodSeconds: string;
  timeoutSeconds: string;
  failureThreshold: string;
}

export interface LifecycleActionForm {
  enabled: boolean;
  type: "exec" | "httpGet";
  command: string[];
  path: string;
  host: string;
  port: string;
  scheme: "HTTP" | "HTTPS";
}

export interface ContainerForm {
  id: string;
  name: string;
  image: string;
  imagePullPolicy: "IfNotPresent" | "Always" | "Never";
  privileged: boolean;
  allowPrivilegeEscalation: boolean;
  readOnlyRootFilesystem: boolean;
  runAsNonRoot: boolean;
  runAsUser: string;
  runAsGroup: string;
  capabilitiesAdd: string[];
  capabilitiesDrop: string[];
  workingDir: string;
  stdin: boolean;
  tty: boolean;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  gpuCount: string;
  gpuResourceName: string;
  ports: ContainerPortForm[];
  command: string[];
  args: string[];
  env: EnvItemForm[];
  envFrom: EnvFromForm[];
  volumeMounts: VolumeMountForm[];
  livenessProbe: ProbeForm;
  readinessProbe: ProbeForm;
  startupProbe: ProbeForm;
  postStart: LifecycleActionForm;
  preStop: LifecycleActionForm;
}

export type VolumeType = "persistentVolumeClaim" | "configMap" | "secret" | "hostPath" | "emptyDir";

export interface VolumeForm {
  id: string;
  name: string;
  type: VolumeType;
  sourceName: string;
  hostPath: string;
  hostPathType: string;
  medium: "" | "Memory";
  sizeLimit: string;
}

export interface EdgeApplicationForm {
  name: string;
  namespace: string;
  type: string;
  replicas: number;
  targetNodeGroup: string;
  imagePullSecrets: string;
  containers: ContainerForm[];
  initContainers: ContainerForm[];
  volumes: VolumeForm[];
  hostNetwork: boolean;
  networkMode: "none" | "portMapping" | "hostNetwork";
  hostPID: boolean;
  hostIPC: boolean;
  shareProcessNamespace: boolean;
  dnsPolicy: string;
  serviceAccountName: string;
  runtimeClassName: string;
  nodeSelectorText: string;
  terminationGracePeriodSeconds: string;
  alias: string;
  description: string;
  workloadLabelsText: string;
  podLabelsText: string;
  workloadAnnotationsText: string;
  podAnnotationsText: string;
  strategyType: "RollingUpdate" | "Recreate";
  maxUnavailable: string;
  maxSurge: string;
  minReadySeconds: string;
  progressDeadlineSeconds: string;
}

let sequence = 0;
export function formId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

export function emptyProbe(): ProbeForm {
  return {
    enabled: false,
    type: "httpGet",
    path: "/health",
    host: "",
    port: "8080",
    scheme: "HTTP",
    command: [],
    initialDelaySeconds: "0",
    periodSeconds: "10",
    timeoutSeconds: "1",
    failureThreshold: "3",
  };
}

export function emptyLifecycleAction(): LifecycleActionForm {
  return { enabled: false, type: "exec", command: [], path: "/", host: "", port: "8080", scheme: "HTTP" };
}

export function emptyContainer(name = "container", image = "nginx:latest"): ContainerForm {
  return {
    id: formId("container"),
    name,
    image,
    imagePullPolicy: "IfNotPresent",
    privileged: false,
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: false,
    runAsNonRoot: false,
    runAsUser: "",
    runAsGroup: "",
    capabilitiesAdd: [],
    capabilitiesDrop: [],
    workingDir: "",
    stdin: false,
    tty: false,
    cpuRequest: "",
    cpuLimit: "100m",
    memoryRequest: "",
    memoryLimit: "128Mi",
    gpuCount: "",
    gpuResourceName: "",
    ports: [],
    command: [],
    args: [],
    env: [],
    envFrom: [],
    volumeMounts: [],
    livenessProbe: emptyProbe(),
    readinessProbe: emptyProbe(),
    startupProbe: emptyProbe(),
    postStart: emptyLifecycleAction(),
    preStop: emptyLifecycleAction(),
  };
}

function numeric(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactRecord(input: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(input).filter(([, value]) => value.trim());
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function buildProbe(form: ProbeForm): Record<string, unknown> | undefined {
  if (!form.enabled) return undefined;
  const handler = form.type === "httpGet"
    ? { httpGet: { path: form.path || "/", host: form.host.trim() || undefined, port: Number(form.port) || form.port, scheme: form.scheme } }
    : form.type === "tcpSocket"
      ? { tcpSocket: { port: Number(form.port) || form.port } }
      : { exec: { command: form.command.filter(Boolean) } };
  return {
    ...handler,
    initialDelaySeconds: numeric(form.initialDelaySeconds),
    periodSeconds: numeric(form.periodSeconds),
    timeoutSeconds: numeric(form.timeoutSeconds),
    failureThreshold: numeric(form.failureThreshold),
  };
}

function buildLifecycleAction(form: LifecycleActionForm): Record<string, unknown> | undefined {
  if (!form.enabled) return undefined;
  if (form.type === "httpGet") {
    return { httpGet: { path: form.path || "/", host: form.host.trim() || undefined, port: Number(form.port) || form.port, scheme: form.scheme } };
  }
  const command = form.command.map((item) => item.trim()).filter(Boolean);
  return command.length ? { exec: { command } } : undefined;
}

export function buildContainer(form: ContainerForm): Record<string, unknown> {
  const command = form.command.map((item) => item.trim()).filter(Boolean);
  const args = form.args.map((item) => item.trim()).filter(Boolean);
  const requests = compactRecord({ cpu: form.cpuRequest, memory: form.memoryRequest });
  const gpuLimit = form.gpuResourceName.trim() && form.gpuCount.trim()
    ? { [form.gpuResourceName.trim()]: form.gpuCount.trim() }
    : {};
  const limits = compactRecord({
    cpu: form.cpuLimit,
    memory: form.memoryLimit,
    ...gpuLimit,
  });
  const capabilitiesAdd = form.capabilitiesAdd.map((item) => item.trim()).filter(Boolean);
  const capabilitiesDrop = form.capabilitiesDrop.map((item) => item.trim()).filter(Boolean);
  const securityContext = {
    privileged: form.privileged,
    allowPrivilegeEscalation: form.allowPrivilegeEscalation,
    readOnlyRootFilesystem: form.readOnlyRootFilesystem,
    runAsNonRoot: form.runAsNonRoot,
    runAsUser: numeric(form.runAsUser),
    runAsGroup: numeric(form.runAsGroup),
    capabilities: capabilitiesAdd.length || capabilitiesDrop.length ? { add: capabilitiesAdd.length ? capabilitiesAdd : undefined, drop: capabilitiesDrop.length ? capabilitiesDrop : undefined } : undefined,
  };
  const postStart = buildLifecycleAction(form.postStart);
  const preStop = buildLifecycleAction(form.preStop);
  return {
    name: form.name.trim(),
    image: form.image.trim(),
    imagePullPolicy: form.imagePullPolicy,
    workingDir: form.workingDir.trim() || undefined,
    stdin: form.stdin || undefined,
    tty: form.tty || undefined,
    command: command.length ? command : undefined,
    args: args.length ? args : undefined,
    securityContext,
    resources: requests || limits ? { requests, limits } : undefined,
    ports: form.ports.filter((port) => port.containerPort.trim()).map((port) => ({
      name: port.name.trim() || undefined,
      containerPort: Number(port.containerPort),
      hostPort: port.hostPort.trim() ? Number(port.hostPort) : undefined,
      hostIP: port.hostIP.trim() || undefined,
      protocol: port.protocol,
    })),
    env: form.env.filter((item) => item.name.trim()).map((item) => ({
      name: item.name.trim(),
      ...(item.source === "value"
        ? { value: item.value }
        : {
            valueFrom: {
              [item.source]: { name: item.resourceName.trim(), key: item.key.trim() },
            },
          }),
    })),
    envFrom: form.envFrom.filter((item) => item.name.trim()).map((item) => ({
      ...(item.prefix.trim() ? { prefix: item.prefix.trim() } : {}),
      [item.source]: { name: item.name.trim() },
    })),
    volumeMounts: form.volumeMounts.filter((item) => item.name.trim() && item.mountPath.trim()).map((item) => ({
      name: item.name.trim(),
      mountPath: item.mountPath.trim(),
      subPath: item.subPath.trim() || undefined,
      subPathExpr: item.subPathExpr.trim() || undefined,
      readOnly: item.readOnly || undefined,
    })),
    livenessProbe: buildProbe(form.livenessProbe),
    readinessProbe: buildProbe(form.readinessProbe),
    startupProbe: buildProbe(form.startupProbe),
    lifecycle: postStart || preStop ? { postStart, preStop } : undefined,
  };
}

export function buildVolume(form: VolumeForm): Record<string, unknown> {
  const source = form.type === "persistentVolumeClaim"
    ? { persistentVolumeClaim: { claimName: form.sourceName.trim() } }
    : form.type === "configMap"
      ? { configMap: { name: form.sourceName.trim() } }
      : form.type === "secret"
        ? { secret: { secretName: form.sourceName.trim() } }
        : form.type === "hostPath"
          ? { hostPath: { path: form.hostPath.trim(), type: form.hostPathType || undefined } }
          : { emptyDir: { medium: form.medium || undefined, sizeLimit: form.sizeLimit.trim() || undefined } };
  return { name: form.name.trim(), ...source };
}

export function buildEdgeApplicationResource(form: EdgeApplicationForm): KubeResource {
  const parsePairs = (text: string): Record<string, string> => Object.fromEntries(text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : [line, ""];
  }).filter(([, value]) => value));
  const labels = { app: form.name, ...parsePairs(form.workloadLabelsText) };
  const podLabels = { app: form.name, ...parsePairs(form.podLabelsText) };
  const annotations = {
    ...parsePairs(form.workloadAnnotationsText),
    ...(form.alias.trim() ? { "blueedge.io/alias": form.alias.trim() } : {}),
    ...(form.description.trim() ? { "blueedge.io/description": form.description.trim() } : {}),
  };
  const podAnnotations = parsePairs(form.podAnnotationsText);
  const nodeSelector = Object.fromEntries(form.nodeSelectorText.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : [line, ""];
  }).filter(([, value]) => value));
  const buildNetworkContainer = (container: ContainerForm) => {
    const built = buildContainer(container);
    if (form.networkMode !== "none") return built;
    return {
      ...built,
      ports: Array.isArray(built.ports) ? built.ports.map((port) => {
        const item = port as Record<string, unknown>;
        return { ...item, hostPort: undefined, hostIP: undefined };
      }) : built.ports,
    };
  };
  const podSpec = {
    hostNetwork: form.networkMode === "hostNetwork" || form.hostNetwork || undefined,
    hostPID: form.hostPID || undefined,
    hostIPC: form.hostIPC || undefined,
    shareProcessNamespace: form.shareProcessNamespace || undefined,
    dnsPolicy: form.dnsPolicy,
    serviceAccountName: form.serviceAccountName.trim() || undefined,
    runtimeClassName: form.runtimeClassName.trim() || undefined,
    nodeSelector: Object.keys(nodeSelector).length ? nodeSelector : undefined,
    terminationGracePeriodSeconds: form.terminationGracePeriodSeconds.trim() ? Number(form.terminationGracePeriodSeconds) : undefined,
    imagePullSecrets: form.imagePullSecrets.split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ name })),
    containers: form.containers.map(buildNetworkContainer),
    initContainers: form.initContainers.length ? form.initContainers.map(buildNetworkContainer) : undefined,
    volumes: form.volumes.length ? form.volumes.map(buildVolume) : undefined,
    restartPolicy: form.type === "Job" ? "OnFailure" : undefined,
  };
  const manifest: KubeResource = {
    apiVersion: form.type === "Job" ? "batch/v1" : form.type === "Pod" ? "v1" : "apps/v1",
    kind: form.type,
    metadata: form.type === "Pod"
      ? { name: form.name, namespace: form.namespace, labels: podLabels, annotations: Object.keys(podAnnotations).length ? podAnnotations : undefined }
      : { name: form.name, namespace: form.namespace, labels, annotations: Object.keys(annotations).length ? annotations : undefined },
    spec: form.type === "Pod" ? podSpec : {
      replicas: form.type === "Deployment" ? form.replicas : undefined,
      selector: form.type === "Deployment" || form.type === "DaemonSet" ? { matchLabels: { app: form.name } } : undefined,
      strategy: form.type === "Deployment" ? {
        type: form.strategyType,
        rollingUpdate: form.strategyType === "RollingUpdate" ? {
          maxUnavailable: form.maxUnavailable.trim() || "25%",
          maxSurge: form.maxSurge.trim() || "25%",
        } : undefined,
      } : undefined,
      minReadySeconds: form.type === "Deployment" && form.minReadySeconds.trim() ? Number(form.minReadySeconds) : undefined,
      progressDeadlineSeconds: form.type === "Deployment" && form.progressDeadlineSeconds.trim() ? Number(form.progressDeadlineSeconds) : undefined,
      template: { metadata: { labels: podLabels, annotations: Object.keys(podAnnotations).length ? podAnnotations : undefined }, spec: podSpec },
    },
  };
  return {
    apiVersion: "apps.kubeedge.io/v1alpha1",
    kind: "EdgeApplication",
    metadata: { name: form.name, namespace: form.namespace, labels, annotations: Object.keys(annotations).length ? annotations : undefined },
    spec: {
      workloadScope: { targetNodeGroups: [{ name: form.targetNodeGroup || "edge-group" }] },
      workloadTemplate: { manifests: [manifest] },
    },
  };
}
import type { KubeResource } from "@/types/kubeedge";
