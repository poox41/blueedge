import WebSocket from "ws";
import { config } from "../config.js";
import { getK8sJson, getServerK8sAuthorization, requestK8sJson } from "../clients/k8s-client.js";
import type {
  DeploymentAction,
  DeploymentAuditItem,
  DeploymentExecPayload,
  DeploymentRevisionItem,
} from "../types/deployment-operations.js";

const previousReplicasAnnotation = "blueedge.io/previous-replicas";
const restartedAtAnnotation = "kubectl.kubernetes.io/restartedAt";

function itemsOf(value: any): any[] {
  return Array.isArray(value?.items) ? value.items : [];
}

function deploymentPath(namespace: string, name: string) {
  return `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`;
}

function replicaSetsPath(namespace: string) {
  return `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/replicasets`;
}

function podPath(namespace: string, name: string) {
  return `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`;
}

function podMatchesDeployment(pod: any, deployment: any) {
  const labels = pod?.metadata?.labels || {};
  const matchLabels = deployment?.spec?.selector?.matchLabels || {};
  const matchExpressions = Array.isArray(deployment?.spec?.selector?.matchExpressions)
    ? deployment.spec.selector.matchExpressions
    : [];
  const labelEntries = Object.entries(matchLabels);
  if (labelEntries.length === 0 && matchExpressions.length === 0) return false;
  return labelEntries.every(([key, value]) => labels[key] === value) && matchExpressions.every((expression: any) => {
    const key = String(expression?.key || "");
    const values = Array.isArray(expression?.values) ? expression.values.map(String) : [];
    if (expression?.operator === "In") return values.includes(labels[key]);
    if (expression?.operator === "NotIn") return labels[key] !== undefined && !values.includes(labels[key]);
    if (expression?.operator === "Exists") return labels[key] !== undefined;
    if (expression?.operator === "DoesNotExist") return labels[key] === undefined;
    return false;
  });
}

function ownerMatches(replicaSet: any, deployment: any) {
  const ownerReferences = Array.isArray(replicaSet?.metadata?.ownerReferences) ? replicaSet.metadata.ownerReferences : [];
  return ownerReferences.some((owner: any) => owner?.kind === "Deployment" && (
    (deployment?.metadata?.uid && owner?.uid === deployment.metadata.uid) || owner?.name === deployment?.metadata?.name
  ));
}

function revisionOf(resource: any): number {
  return Number(resource?.metadata?.annotations?.["deployment.kubernetes.io/revision"] || 0);
}

function revisionView(replicaSet: any, currentRevision: number): DeploymentRevisionItem {
  const copy = structuredClone(replicaSet);
  if (copy?.metadata) delete copy.metadata.managedFields;
  const initContainers = Array.isArray(replicaSet?.spec?.template?.spec?.initContainers) ? replicaSet.spec.template.spec.initContainers : [];
  const containers = Array.isArray(replicaSet?.spec?.template?.spec?.containers) ? replicaSet.spec.template.spec.containers : [];
  const revision = revisionOf(replicaSet);
  return {
    revision,
    current: revision === currentRevision,
    replicaSetName: String(replicaSet?.metadata?.name || ""),
    createdAt: String(replicaSet?.metadata?.creationTimestamp || ""),
    images: [...initContainers, ...containers].map((container: any) => String(container?.image || "")).filter(Boolean),
    replicas: Number(replicaSet?.status?.replicas || 0),
    availableReplicas: Number(replicaSet?.status?.availableReplicas || 0),
    yaml: copy,
  };
}

export async function listDeploymentRevisions(namespace: string, name: string) {
  const [deployment, replicaSets] = await Promise.all([
    getK8sJson(deploymentPath(namespace, name)),
    getK8sJson(replicaSetsPath(namespace)),
  ]);
  const currentRevision = revisionOf(deployment);
  const items = itemsOf(replicaSets)
    .filter((replicaSet) => ownerMatches(replicaSet, deployment))
    .map((replicaSet) => revisionView(replicaSet, currentRevision))
    .sort((left, right) => right.revision - left.revision);
  return { items, currentRevision, source: "apps/v1 ReplicaSet" };
}

export async function rollbackDeployment(namespace: string, name: string, revision: number) {
  const [deployment, replicaSets] = await Promise.all([
    getK8sJson(deploymentPath(namespace, name)),
    getK8sJson(replicaSetsPath(namespace)),
  ]);
  const target = itemsOf(replicaSets).find((replicaSet) => ownerMatches(replicaSet, deployment) && revisionOf(replicaSet) === revision);
  if (!target) throw new Error(`revision ${revision} not found`);

  deployment.spec = deployment.spec || {};
  deployment.spec.template = structuredClone(target.spec?.template || {});
  if (deployment.spec.template?.metadata?.labels) {
    delete deployment.spec.template.metadata.labels["pod-template-hash"];
  }
  deployment.metadata.annotations = {
    ...(deployment.metadata?.annotations || {}),
    "blueedge.io/rollback-from-revision": String(revision),
    "blueedge.io/rollback-at": new Date().toISOString(),
  };
  return requestK8sJson(deploymentPath(namespace, name), { method: "PUT", body: deployment });
}

export async function runDeploymentAction(namespace: string, name: string, action: DeploymentAction) {
  const deployment = await getK8sJson(deploymentPath(namespace, name));
  deployment.metadata = deployment.metadata || {};
  deployment.metadata.annotations = { ...(deployment.metadata.annotations || {}) };
  deployment.spec = deployment.spec || {};

  if (action === "stop") {
    const replicas = Number(deployment.spec.replicas ?? 1);
    if (replicas > 0) deployment.metadata.annotations[previousReplicasAnnotation] = String(replicas);
    deployment.spec.replicas = 0;
  } else if (action === "start") {
    const previous = Number(deployment.metadata.annotations[previousReplicasAnnotation] || 1);
    deployment.spec.replicas = Number.isFinite(previous) && previous > 0 ? previous : 1;
    delete deployment.metadata.annotations[previousReplicasAnnotation];
  } else {
    deployment.spec.template = deployment.spec.template || {};
    deployment.spec.template.metadata = deployment.spec.template.metadata || {};
    deployment.spec.template.metadata.annotations = {
      ...(deployment.spec.template.metadata.annotations || {}),
      [restartedAtAnnotation]: new Date().toISOString(),
    };
  }

  return requestK8sJson(deploymentPath(namespace, name), { method: "PUT", body: deployment });
}

export async function getDeploymentAudit(namespace: string, name: string) {
  const deployment = await getK8sJson(deploymentPath(namespace, name));
  const fields = Array.isArray(deployment?.metadata?.managedFields) ? deployment.metadata.managedFields : [];
  const items: DeploymentAuditItem[] = fields
    .map((field: any) => ({
      manager: String(field?.manager || "unknown"),
      operation: String(field?.operation || "unknown"),
      apiVersion: String(field?.apiVersion || ""),
      subresource: String(field?.subresource || ""),
      time: String(field?.time || ""),
    }))
    .sort((left: DeploymentAuditItem, right: DeploymentAuditItem) => right.time.localeCompare(left.time));
  return {
    items,
    source: "metadata.managedFields",
    completeAuditLog: false,
    warning: "当前集群未向 BlueEdge 暴露 Kubernetes Audit 日志；这里展示的是资源 managedFields 变更记录，不包含访问者 IP。",
  };
}

function execWebSocketUrl(namespace: string, payload: DeploymentExecPayload) {
  if (!config.k8sApiServer) throw new Error("K8S_API_SERVER is not configured");
  const url = new URL(config.k8sApiServer);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(payload.pod)}/exec`;
  url.searchParams.set("container", payload.container);
  url.searchParams.set("stdin", "false");
  url.searchParams.set("stdout", "true");
  url.searchParams.set("stderr", "true");
  url.searchParams.set("tty", "false");
  ["/bin/sh", "-lc", payload.command].forEach((command) => url.searchParams.append("command", command));
  return url.toString();
}

export async function executePodCommand(namespace: string, deploymentName: string, payload: DeploymentExecPayload) {
  const authorization = getServerK8sAuthorization();
  if (!authorization) throw new Error("Kubernetes authorization is not configured");

  const [deployment, pod] = await Promise.all([
    getK8sJson(deploymentPath(namespace, deploymentName)),
    getK8sJson(podPath(namespace, payload.pod)),
  ]);
  if (!podMatchesDeployment(pod, deployment)) {
    throw new Error(`pod ${payload.pod} does not belong to deployment ${deploymentName}`);
  }
  const containers = Array.isArray(pod?.spec?.containers) ? pod.spec.containers : [];
  if (!containers.some((container: any) => container?.name === payload.container)) {
    throw new Error(`container ${payload.container} not found in pod ${payload.pod}`);
  }

  return new Promise<{ item: { pod: string; container: string; command: string; stdout: string; stderr: string; exitCode: number | null } }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    let settled = false;
    const socket = new WebSocket(execWebSocketUrl(namespace, payload), "v4.channel.k8s.io", {
      headers: { Authorization: authorization },
      rejectUnauthorized: !config.k8sSkipTlsVerify,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(new Error("Pod exec timed out"));
    }, config.requestTimeoutMs);

    socket.on("message", (data) => {
      const message = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const channel = message[0];
      const content = message.subarray(1).toString("utf8");
      if (channel === 1) stdout += content;
      if (channel === 2) stderr += content;
      if (channel === 3) {
        try {
          const status = JSON.parse(content);
          const exitCause = status?.details?.causes?.find((cause: any) => cause?.reason === "ExitCode");
          if (exitCause) exitCode = Number(exitCause.message);
          if (status?.status === "Failure" && !exitCause) stderr += status?.message || content;
        } catch {
          stderr += content;
        }
      }
    });
    socket.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ item: { ...payload, stdout, stderr, exitCode } });
    });
  });
}
