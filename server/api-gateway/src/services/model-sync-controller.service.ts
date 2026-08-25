import crypto from "node:crypto";
import { config } from "../config.js";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import {
  listModelSyncTasks,
  updateModelSyncTaskStatus,
} from "../repositories/model-sync-task.repository.js";

const artifactAnnotations = {
  storeModel: "blueedge.io/model-store-name",
  storeVolume: "blueedge.io/model-store-volume",
  legacyInit: "blueedge.io/model-legacy-init",
  legacyImage: "blueedge.io/model-legacy-image",
  contentVersion: "blueedge.io/model-content-version",
  artifactRef: "blueedge.io/model-artifact-ref",
} as const;


function safeSegment(value: unknown, field: string) {
  const text = String(value || "");
  if (!/^[a-z0-9](?:[-a-z0-9.]{0,61}[a-z0-9])?$/.test(text)) {
    throw new Error(`${field} is not safe for a model store path`);
  }
  return text;
}

function taskStorePath(task: any) {
  const namespace = safeSegment(task?.spec?.deployment?.namespace, "deployment namespace");
  const deployment = safeSegment(task?.spec?.deployment?.name, "deployment name");
  const model = safeSegment(task?.spec?.deployment?.modelName, "model name");
  const root = config.modelSyncStoreHostPath.replace(/\/+$/, "");
  if (!root.startsWith("/") || root.split("/").some((part) => part === "..")) {
    throw new Error("MODEL_SYNC_STORE_HOST_PATH must be an absolute normalized path");
  }
  return `${root}/${namespace}/${deployment}/${model}`;
}

export function buildModelSyncJob(task: any) {
  if (!config.modelSyncExecutorImage) throw new Error("MODEL_SYNC_EXECUTOR_IMAGE is not configured");
  const namespace = safeSegment(task?.metadata?.namespace, "task namespace");
  const taskName = safeSegment(task?.metadata?.name, "task name");
  const targetNode = safeSegment(task?.spec?.targetNode, "target node");
  const pullSecret = safeSegment(task?.spec?.registry?.pullSecretName, "Registry pull Secret");
  let registryUrl: URL;
  try {
    registryUrl = new URL(String(task?.spec?.registry?.url || ""));
  } catch {
    throw new Error("ModelSyncTask Registry URL is invalid");
  }
  if (!["http:", "https:"].includes(registryUrl.protocol)
    || registryUrl.username || registryUrl.password || registryUrl.pathname !== "/"
    || registryUrl.search || registryUrl.hash) {
    throw new Error("ModelSyncTask Registry URL must contain only an HTTP(S) host");
  }
  const artifactRef = String(task?.spec?.artifact?.artifactRef || "");
  if (!artifactRef.toLowerCase().startsWith(`${registryUrl.host.toLowerCase()}/`)
    || !/@sha256:[a-f0-9]{64}$/.test(artifactRef)) {
    throw new Error("ModelSyncTask artifact reference does not match its Registry");
  }
  const storePath = taskStorePath(task);
  const args = [
    "--registry-url", registryUrl.toString().replace(/\/$/, ""),
    "--artifact-ref", artifactRef,
    "--docker-config", "/registry-auth/.dockerconfigjson",
    "--store-root", "/model-store",
    "--result", `/model-store/.task-${taskName}.json`,
  ];
  const volumes: any[] = [
    { name: "model-store", hostPath: { path: storePath, type: "DirectoryOrCreate" } },
    { name: "registry-auth", secret: { secretName: pullSecret } },
  ];
  const mounts: any[] = [
    { name: "model-store", mountPath: "/model-store" },
    { name: "registry-auth", mountPath: "/registry-auth", readOnly: true },
  ];
  const registryCaSecret = String(task?.spec?.registry?.caSecretName || config.modelSyncRegistryCaSecret || "");
  if (registryCaSecret) {
    safeSegment(registryCaSecret, "Registry CA Secret");
    volumes.push({ name: "registry-ca", secret: { secretName: registryCaSecret } });
    mounts.push({ name: "registry-ca", mountPath: "/registry-ca", readOnly: true });
    args.push("--ca-file", "/registry-ca/ca.crt");
  } else if (config.modelSyncRegistrySkipTlsVerify) {
    args.push("--skip-tls-verify");
  }
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: `${taskName}-sync`,
      namespace,
      labels: { "blueedge.io/model-sync-task": taskName },
      ownerReferences: task?.metadata?.uid ? [{
        apiVersion: "blueedge.io/v1alpha1", kind: "ModelSyncTask",
        name: taskName, uid: task.metadata.uid, controller: true, blockOwnerDeletion: true,
      }] : [],
    },
    spec: {
      backoffLimit: 2,
      ttlSecondsAfterFinished: 86400,
      template: {
        metadata: { labels: { "blueedge.io/model-sync-task": taskName } },
        spec: {
          nodeName: targetNode,
          restartPolicy: "Never",
          imagePullSecrets: [
            { name: pullSecret },
            ...(config.modelSyncExecutorPullSecret ? [{ name: config.modelSyncExecutorPullSecret }] : []),
          ],
          tolerations: [{ key: "node-role.kubernetes.io/edge", operator: "Exists", effect: "NoSchedule" }],
          containers: [{
            name: "sync", image: config.modelSyncExecutorImage,
            imagePullPolicy: "IfNotPresent", args, volumeMounts: mounts,
            resources: {
              requests: { cpu: "100m", memory: "128Mi" },
              limits: { cpu: "1", memory: "512Mi" },
            },
            securityContext: { allowPrivilegeEscalation: false },
          }],
          volumes,
        },
      },
    },
  };
}

export function applyModelArtifactMount(deployment: any, task: any) {
  const copy = structuredClone(deployment);
  const podSpec = copy?.spec?.template?.spec;
  if (!podSpec) throw new Error("Deployment pod template is missing");
  const initName = String(task?.spec?.deployment?.initContainerName || "");
  const runtimeName = String(task?.spec?.deployment?.runtimeContainerName || "triton");
  const modelName = safeSegment(task?.spec?.deployment?.modelName, "model name");
  const runtime = (podSpec.containers || []).find((item: any) => item?.name === runtimeName);
  if (!runtime) throw new Error(`runtime container ${runtimeName} was not found`);
  podSpec.nodeName = safeSegment(task?.spec?.targetNode, "target node");
  const existingInitContainers = Array.isArray(podSpec.initContainers) ? podSpec.initContainers : [];
  const initIndex = existingInitContainers.findIndex((item: any) => item?.name === initName);
  const annotations = copy?.metadata?.annotations || {};
  if (initIndex < 0 && (
    annotations[artifactAnnotations.storeModel] !== modelName
    || !annotations[artifactAnnotations.legacyInit]
  )) {
    throw new Error(`model initContainer ${initName} was not found and no persistent model metadata exists`);
  }
  if (initIndex >= 0) {
    const legacy = Buffer.from(JSON.stringify({
      index: initIndex,
      container: existingInitContainers[initIndex],
    }), "utf8").toString("base64url");
    if (legacy.length > 64 * 1024) throw new Error("model initContainer is too large to preserve for rollback");
    annotations[artifactAnnotations.legacyInit] = legacy;
    annotations[artifactAnnotations.legacyImage] = String(existingInitContainers[initIndex].image || "");
  }
  podSpec.initContainers = existingInitContainers.filter((item: any) => item?.name !== initName);
  const volumeName = `model-artifact-${crypto.createHash("sha256").update(modelName).digest("hex").slice(0, 10)}`;
  podSpec.volumes = (podSpec.volumes || []).filter((item: any) => item?.name !== volumeName);
  podSpec.volumes.push({ name: volumeName, hostPath: { path: `${taskStorePath(task)}/current`, type: "Directory" } });
  runtime.volumeMounts = (runtime.volumeMounts || []).filter((item: any) => item?.name !== volumeName);
  runtime.volumeMounts.push({ name: volumeName, mountPath: `/model-repo/${modelName}`, readOnly: true });
  copy.metadata.annotations = {
    ...annotations,
    [artifactAnnotations.storeModel]: modelName,
    [artifactAnnotations.storeVolume]: volumeName,
    [artifactAnnotations.contentVersion]: String(task.spec.artifact.contentVersion),
    [artifactAnnotations.artifactRef]: String(task.spec.artifact.artifactRef),
    "blueedge.io/model-publish-operation": "updating",
  };
  copy.spec.template.metadata = copy.spec.template.metadata || {};
  copy.spec.template.metadata.annotations = {
    ...(copy.spec.template.metadata.annotations || {}),
    "blueedge.io/model-content-updated-at": new Date().toISOString(),
  };
  return copy;
}

export function restoreLegacyModelDeployment(
  deployment: any,
  nextImage: string,
  deploymentAnnotations: Record<string, string> = {},
) {
  const copy = structuredClone(deployment);
  const annotations = copy?.metadata?.annotations || {};
  const encoded = String(annotations[artifactAnnotations.legacyInit] || "");
  const volumeName = String(annotations[artifactAnnotations.storeVolume] || "");
  if (!encoded || !volumeName) throw new Error("Deployment has no persistent model rollback metadata");
  let saved: any;
  try {
    saved = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Deployment persistent model rollback metadata is invalid");
  }
  if (!saved?.container?.name || !Number.isInteger(saved?.index) || saved.index < 0) {
    throw new Error("Deployment persistent model rollback metadata is incomplete");
  }
  const podSpec = copy?.spec?.template?.spec;
  if (!podSpec) throw new Error("Deployment pod template is missing");
  const initContainers = (Array.isArray(podSpec.initContainers) ? podSpec.initContainers : [])
    .filter((item: any) => item?.name !== saved.container.name);
  const restoredContainer = structuredClone(saved.container);
  restoredContainer.image = nextImage;
  initContainers.splice(Math.min(saved.index, initContainers.length), 0, restoredContainer);
  podSpec.initContainers = initContainers;
  podSpec.volumes = (podSpec.volumes || []).filter((item: any) => item?.name !== volumeName);
  for (const container of [...(podSpec.containers || []), ...(podSpec.initContainers || [])]) {
    if (Array.isArray(container?.volumeMounts)) {
      container.volumeMounts = container.volumeMounts.filter((item: any) => item?.name !== volumeName);
    }
  }
  for (const key of Object.values(artifactAnnotations)) delete annotations[key];
  copy.metadata.annotations = { ...annotations, ...deploymentAnnotations };
  copy.spec.template.metadata = copy.spec.template.metadata || {};
  copy.spec.template.metadata.annotations = {
    ...(copy.spec.template.metadata.annotations || {}),
    "blueedge.io/model-image-updated-at": new Date().toISOString(),
  };
  return copy;
}

export function persistentModelMetadata(deployment: any, modelName: string) {
  const annotations = deployment?.metadata?.annotations || {};
  if (annotations[artifactAnnotations.storeModel] !== modelName) return null;
  let savedInitContainerName = "";
  try {
    const saved = JSON.parse(Buffer.from(String(annotations[artifactAnnotations.legacyInit] || ""), "base64url").toString("utf8"));
    savedInitContainerName = String(saved?.container?.name || "");
  } catch {
    // Invalid rollback metadata is reported by the caller as incomplete persistent metadata.
  }
  return {
    modelName,
    initContainerName: String(deployment?.metadata?.annotations?.["blueedge.io/model-init-container"] || savedInitContainerName),
    legacyImage: String(annotations[artifactAnnotations.legacyImage] || ""),
    contentVersion: String(annotations[artifactAnnotations.contentVersion] || ""),
    artifactRef: String(annotations[artifactAnnotations.artifactRef] || ""),
  };
}

type ControllerDependencies = {
  listTasks(): Promise<any[]>;
  updateTaskStatus(task: any, status: any): Promise<any>;
  createJob(namespace: string, job: any): Promise<any>;
  getJob(namespace: string, name: string): Promise<any>;
  getDeployment(namespace: string, name: string): Promise<any>;
  updateDeployment(namespace: string, name: string, deployment: any): Promise<any>;
  listDeploymentPods(namespace: string, selector: Record<string, string>): Promise<any[]>;
  ensureRegistryCa(task: any): Promise<void>;
  now(): Date;
};

const terminalPhases = new Set(["SUCCEEDED", "FAILED"]);

function resourceName(task: any) {
  return safeSegment(task?.metadata?.name, "task name");
}

function resourceNamespace(task: any) {
  return safeSegment(task?.metadata?.namespace, "task namespace");
}

function jobName(task: any) {
  return `${resourceName(task)}-sync`;
}

function isoNow(dependencies: ControllerDependencies) {
  return dependencies.now().toISOString();
}

function elapsed(timestamp: unknown, dependencies: ControllerDependencies) {
  const started = Date.parse(String(timestamp || ""));
  return Number.isFinite(started) ? dependencies.now().getTime() - started : 0;
}

function jobState(job: any): { state: "RUNNING" | "SUCCEEDED" | "FAILED"; message?: string } {
  const conditions = Array.isArray(job?.status?.conditions) ? job.status.conditions : [];
  const failed = conditions.find((item: any) => item?.type === "Failed" && item?.status === "True");
  if (failed || Number(job?.status?.failed || 0) > Number(job?.spec?.backoffLimit ?? 2)) {
    return { state: "FAILED", message: String(failed?.message || failed?.reason || "model sync Job failed") };
  }
  const complete = conditions.find((item: any) => item?.type === "Complete" && item?.status === "True");
  if (complete || Number(job?.status?.succeeded || 0) >= 1) return { state: "SUCCEEDED" };
  return { state: "RUNNING" };
}

function deploymentRollout(deployment: any, pods: any[]) {
  const desired = Number(deployment?.spec?.replicas ?? 1);
  const generation = Number(deployment?.metadata?.generation || 0);
  const status = deployment?.status || {};
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  const failure = conditions.find((item: any) =>
    (item?.type === "Progressing" && item?.status === "False" && item?.reason === "ProgressDeadlineExceeded")
    || (item?.type === "ReplicaFailure" && item?.status === "True"));
  if (failure) return { state: "FAILED", message: String(failure.message || failure.reason || "Deployment rollout failed") };
  for (const pod of pods) {
    const statuses = [
      ...(Array.isArray(pod?.status?.initContainerStatuses) ? pod.status.initContainerStatuses : []),
      ...(Array.isArray(pod?.status?.containerStatuses) ? pod.status.containerStatuses : []),
    ];
    const failedContainer = statuses.find((item: any) => {
      const reason = String(item?.state?.waiting?.reason || "");
      return ["ImagePullBackOff", "ErrImagePull", "CrashLoopBackOff"].includes(reason)
        || Number(item?.state?.terminated?.exitCode || 0) !== 0;
    });
    if (failedContainer) return { state: "FAILED", message: `Pod ${pod?.metadata?.name || ""} failed during rollout` };
  }
  const readyPods = pods.filter((pod: any) =>
    !pod?.metadata?.deletionTimestamp
    && pod?.status?.phase === "Running"
    && (pod?.status?.conditions || []).some((item: any) => item?.type === "Ready" && item?.status === "True"));
  const ready = Number(status.observedGeneration || 0) >= generation
    && Number(status.updatedReplicas || 0) >= desired
    && Number(status.availableReplicas || 0) >= desired
    && readyPods.length >= desired;
  return ready ? { state: "SUCCEEDED" } : { state: "RUNNING" };
}

function deploymentSnapshot(deployment: any) {
  return {
    annotations: structuredClone(deployment?.metadata?.annotations || {}),
    spec: structuredClone(deployment?.spec || {}),
  };
}

function restoreDeployment(current: any, snapshot: any) {
  if (!snapshot?.spec || !snapshot?.annotations) throw new Error("rollback Deployment snapshot is missing");
  const restored = structuredClone(current);
  restored.spec = structuredClone(snapshot.spec);
  restored.metadata.annotations = structuredClone(snapshot.annotations);
  return restored;
}

function selectorOf(deployment: any): Record<string, string> {
  const labels = deployment?.spec?.selector?.matchLabels;
  return labels && typeof labels === "object" ? labels : {};
}

async function status(task: any, dependencies: ControllerDependencies, patch: Record<string, unknown>) {
  return dependencies.updateTaskStatus(task, {
    ...(task?.status || {}),
    ...patch,
    observedGeneration: Number(task?.metadata?.generation || 0),
    updatedAt: isoNow(dependencies),
  });
}

async function beginRollback(task: any, dependencies: ControllerDependencies, message: string) {
  const namespace = String(task.spec.deployment.namespace);
  const name = String(task.spec.deployment.name);
  const current = await dependencies.getDeployment(namespace, name);
  await dependencies.updateDeployment(namespace, name, restoreDeployment(current, task?.status?.rollback?.deployment));
  await status(task, dependencies, {
    phase: "ROLLING_BACK",
    message,
    rollbackStartedAt: isoNow(dependencies),
  });
}

export async function reconcileModelSyncTask(task: any, dependencies: ControllerDependencies) {
  const phase = String(task?.status?.phase || "PENDING");
  if (terminalPhases.has(phase)) return task;
  const namespace = resourceNamespace(task);
  if (phase === "PENDING") {
    await dependencies.ensureRegistryCa(task);
    try {
      await dependencies.createJob(namespace, buildModelSyncJob(task));
    } catch (error) {
      if (!/409|AlreadyExists/i.test(error instanceof Error ? error.message : "")) throw error;
    }
    return status(task, dependencies, {
      phase: "SYNCING", jobName: jobName(task), startedAt: isoNow(dependencies), message: "model artifact sync is running",
    });
  }
  if (phase === "SYNCING") {
    const job = await dependencies.getJob(namespace, String(task.status.jobName || jobName(task)));
    const state = jobState(job);
    if (state.state === "FAILED") {
      return status(task, dependencies, { phase: "FAILED", completedAt: isoNow(dependencies), message: state.message });
    }
    if (state.state === "RUNNING") return task;
    const deploymentNamespace = String(task.spec.deployment.namespace);
    const deploymentName = String(task.spec.deployment.name);
    const current = await dependencies.getDeployment(deploymentNamespace, deploymentName);
    const rollback = { deployment: deploymentSnapshot(current) };
    await dependencies.updateDeployment(
      deploymentNamespace, deploymentName, applyModelArtifactMount(current, task),
    );
    return status(task, dependencies, {
      phase: "SWITCHING", switchedAt: isoNow(dependencies), rollback,
      message: "model content is verified; Deployment rollout is running",
    });
  }
  if (phase === "SWITCHING" || phase === "ROLLING_BACK") {
    const deploymentNamespace = String(task.spec.deployment.namespace);
    const deploymentName = String(task.spec.deployment.name);
    const deployment = await dependencies.getDeployment(deploymentNamespace, deploymentName);
    const pods = await dependencies.listDeploymentPods(deploymentNamespace, selectorOf(deployment));
    const rollout = deploymentRollout(deployment, pods);
    if (phase === "SWITCHING") {
      if (rollout.state === "SUCCEEDED") {
        return status(task, dependencies, {
          phase: "SUCCEEDED", completedAt: isoNow(dependencies), message: "incremental model update completed",
        });
      }
      if (rollout.state === "FAILED" || elapsed(task.status.switchedAt, dependencies) > config.modelSyncRolloutTimeoutMs) {
        await beginRollback(task, dependencies, rollout.message || "Deployment rollout timed out");
      }
      return task;
    }
    if (rollout.state === "SUCCEEDED") {
      return status(task, dependencies, {
        phase: "FAILED", completedAt: isoNow(dependencies), rollbackState: "SUCCEEDED",
        message: String(task.status.message || "incremental model update failed and was rolled back"),
      });
    }
    if (rollout.state === "FAILED" || elapsed(task.status.rollbackStartedAt, dependencies) > config.modelSyncRolloutTimeoutMs) {
      return status(task, dependencies, {
        phase: "FAILED", completedAt: isoNow(dependencies), rollbackState: "FAILED",
        message: `rollback failed: ${rollout.message || "rollout timed out"}`,
      });
    }
  }
  return task;
}

function selectorQuery(labels: Record<string, string>) {
  return encodeURIComponent(Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(","));
}

const productionDependencies: ControllerDependencies = {
  listTasks: listModelSyncTasks,
  updateTaskStatus: updateModelSyncTaskStatus,
  createJob(namespace, job) {
    return requestK8sJson(`/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`, { method: "POST", body: job });
  },
  getJob(namespace, name) {
    return getK8sJson(`/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs/${encodeURIComponent(name)}`);
  },
  getDeployment(namespace, name) {
    return getK8sJson(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`);
  },
  updateDeployment(namespace, name, deployment) {
    return requestK8sJson(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`, { method: "PUT", body: deployment });
  },
  async listDeploymentPods(namespace, selector) {
    const result = await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${selectorQuery(selector)}`);
    return Array.isArray(result?.items) ? result.items : [];
  },
  async ensureRegistryCa(task) {
    const sourceNamespace = String(task?.spec?.registry?.caSourceNamespace || "");
    const sourceName = String(task?.spec?.registry?.caSourceName || "");
    const targetName = String(task?.spec?.registry?.caSecretName || "");
    if (!sourceName && !targetName) return;
    safeSegment(sourceNamespace, "Registry CA source namespace");
    safeSegment(sourceName, "Registry CA source Secret");
    safeSegment(targetName, "Registry CA target Secret");
    const targetNamespace = resourceNamespace(task);
    const source = await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(sourceNamespace)}/secrets/${encodeURIComponent(sourceName)}`);
    const ca = source?.data?.["ca.crt"];
    if (typeof ca !== "string" || !ca) throw new Error("Registry CA source Secret contains no ca.crt");
    const body = {
      apiVersion: "v1", kind: "Secret",
      metadata: {
        name: targetName, namespace: targetNamespace,
        labels: { "blueedge.io/managed-by": "model-sync-controller" },
      },
      type: "Opaque",
      data: { "ca.crt": ca },
    };
    const collection = `/api/v1/namespaces/${encodeURIComponent(targetNamespace)}/secrets`;
    try {
      await requestK8sJson(collection, { method: "POST", body });
    } catch (error) {
      if (!/409|AlreadyExists/i.test(error instanceof Error ? error.message : "")) throw error;
      const path = `${collection}/${encodeURIComponent(targetName)}`;
      const current = await getK8sJson(path);
      if (current?.data?.["ca.crt"] !== ca) {
        await requestK8sJson(path, {
          method: "PUT",
          body: { ...body, metadata: { ...body.metadata, resourceVersion: current?.metadata?.resourceVersion } },
        });
      }
    }
  },
  now: () => new Date(),
};

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

export async function reconcileAllModelSyncTasks(dependencies = productionDependencies) {
  if (running) return;
  running = true;
  try {
    const active = (await dependencies.listTasks())
      .filter((task) => !terminalPhases.has(String(task?.status?.phase || "PENDING")))
      .sort((left, right) => String(left?.metadata?.creationTimestamp || left?.metadata?.name || "")
        .localeCompare(String(right?.metadata?.creationTimestamp || right?.metadata?.name || "")));
    const claimedDeployments = new Set<string>();
    for (const task of active) {
      const deploymentKey = `${task?.spec?.deployment?.namespace || ""}/${task?.spec?.deployment?.name || ""}`;
      if (claimedDeployments.has(deploymentKey)) continue;
      claimedDeployments.add(deploymentKey);
      try {
        await reconcileModelSyncTask(task, dependencies);
      } catch (error) {
        console.error(`ModelSyncTask ${task?.metadata?.namespace || ""}/${task?.metadata?.name || ""} reconcile failed`, error);
      }
    }
  } finally {
    running = false;
  }
}

export function startModelSyncController() {
  if (!config.modelSyncControllerEnabled || timer) return;
  void reconcileAllModelSyncTasks();
  timer = setInterval(() => void reconcileAllModelSyncTasks(), config.modelSyncControllerIntervalMs);
  timer.unref();
  console.log(`Model sync controller enabled; interval=${config.modelSyncControllerIntervalMs}ms`);
}
