import crypto from "node:crypto";
import { config } from "../config.js";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import { getEdgeUnitConfigMaps } from "./edge-unit-source.service.js";
import { edgeUnitConfigMapMatches } from "./edge-unit-source.service.js";
import { isExternalEdgeNode, nodeTargetsEdgeUnit } from "./edge-unit.service.js";
import {
  edgeUnitRegistryConnection,
  modelImagePrefix,
  modelImageReference,
  updateModelImage,
  type ModelRegistryConnection,
} from "./model-registry.service.js";
import {
  readEdgeUnitRegistryCa,
  readEdgeUnitRegistryCredential,
  resolveEdgeUnitModelRegistry,
  type EdgeUnitModelRegistry,
} from "./edge-unit-model-registry.service.js";
import {
  buildTritonDeployment,
  resolveModelRuntimeTemplate,
  runtimeTemplateIdForPredictFramework,
} from "./model-runtime-template.service.js";
import { isNodeReady, itemsOf, labelsOf, metadataOf, nodeNameOf } from "../utils/kubernetes.js";
import { createModelSyncTask, getModelSyncTask } from "../repositories/model-sync-task.repository.js";
import {
  persistentModelMetadata,
  restoreLegacyModelDeployment,
} from "./model-sync-controller.service.js";

const identityKeys = {
  managedBy: "blueedge.io/managed-by",
  source: "blueedge.io/source",
  spaceId: "blueedge.io/bams-space-id",
  modelRepoId: "blueedge.io/bams-model-repo-id",
  edgeUnit: "blueedge.io/edge-unit",
} as const;

const annotationKeys = {
  modelImageId: "blueedge.io/bams-model-image-id",
  modelVersionId: "blueedge.io/bams-model-version-id",
  runtimeTemplate: "blueedge.io/runtime-template",
  runtimeTemplateVersion: "blueedge.io/runtime-template-version",
  modelInitContainer: "blueedge.io/model-init-container",
  publishOperation: "blueedge.io/model-publish-operation",
} as const;

export type ModelPublishRequest = {
  source: "bams";
  spaceId: string;
  modelRepoId: string;
  modelVersionId: string;
  modelImageId: string;
  image: string;
  predictFramework?: string;
  runtimeTemplateId?: string;
  edgeUnit: string;
  targetType?: "node";
  targetId?: string;
  artifact?: {
    schemaVersion: number;
    contentVersion: string;
    manifestDigest: string;
    artifactRef: string;
    fileCount: number;
    totalBytes: number;
  };
  updatePolicy?: "LEGACY_IMAGE" | "INCREMENTAL_RESTART";
};

export class ModelDeploymentError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function modelIncrementalCapabilities() {
  const enabled = config.modelIncrementalSyncEnabled
    && config.modelSyncControllerEnabled
    && Boolean(config.modelSyncExecutorImage);
  return {
    incrementalSync: enabled,
    persistentStorage: enabled,
    artifactSchemaVersions: [...config.modelArtifactSchemaVersions],
    updatePolicies: enabled
      ? ["LEGACY_IMAGE", "INCREMENTAL_RESTART"]
      : ["LEGACY_IMAGE"],
    hotReload: false,
  };
}

type PublishDependencies = {
  edgeUnitExists(edgeUnit: string): Promise<boolean>;
  getModelRegistry(edgeUnit: string): Promise<EdgeUnitModelRegistry>;
  getNode(name: string): Promise<any>;
  listNodes(): Promise<any[]>;
  listPods(deployment: any): Promise<any[]>;
  secretExists(namespace: string, name: string): Promise<boolean>;
  listManagedDeployments(labels: Record<string, string>): Promise<any[]>;
  listEdgeUnitDeployments(edgeUnit: string): Promise<any[]>;
  createDeployment(namespace: string, deployment: any): Promise<any>;
  updateImage(namespace: string, name: string, payload: {
    containerName: string;
    model: string;
    tag: string;
    expectedCurrentImage: string;
  }, annotations: Record<string, string>, registry: EdgeUnitModelRegistry): Promise<any>;
  createModelSyncTask(namespace: string, resource: any): Promise<{ item: any; idempotent: boolean }>;
  restoreLegacyImage(namespace: string, name: string, image: string, annotations: Record<string, string>): Promise<any>;
};

export function deterministicModelSyncTaskName(input: ModelPublishRequest): string {
  const identity = [
    input.source,
    input.spaceId,
    input.modelRepoId,
    input.edgeUnit,
    input.targetId || "existing",
    input.artifact?.contentVersion || "",
    input.updatePolicy || "LEGACY_IMAGE",
  ].join(":");
  return `model-sync-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

function buildModelSyncTask(input: ModelPublishRequest, resolution: any, image: { model: string; reference: string }, targetNode: string) {
  const namespace = config.modelDeploymentNamespace;
  const deploymentName = resolution.action === "UPDATE"
    ? String(resolution.workload.name)
    : deterministicModelDeploymentName(input);
  return {
    apiVersion: "blueedge.io/v1alpha1",
    kind: "ModelSyncTask",
    metadata: {
      name: deterministicModelSyncTaskName({ ...input, targetId: targetNode }),
      namespace,
      labels: {
        ...modelDeploymentIdentity(input),
        "blueedge.io/model-sync-phase": "pending",
      },
    },
    spec: {
      source: input.source,
      spaceId: input.spaceId,
      modelRepoId: input.modelRepoId,
      modelVersionId: input.modelVersionId,
      modelImageId: input.modelImageId,
      edgeUnit: input.edgeUnit,
      targetNode,
      updatePolicy: "INCREMENTAL_RESTART",
      artifact: input.artifact,
      registry: {
        url: `${resolution.registry.tls ? "https" : "http"}://${resolution.registry.registryHost}`,
        pullSecretName: resolution.registry.pullSecretName,
        ...(resolution.registry.caSecretRef ? {
          caSourceNamespace: config.blueedgeSystemNamespace,
          caSourceName: resolution.registry.caSecretRef,
          caSecretName: `model-registry-ca-${crypto.createHash("sha256").update(input.edgeUnit).digest("hex").slice(0, 10)}`,
        } : {}),
      },
      deployment: {
        action: resolution.action,
        namespace,
        name: deploymentName,
        modelName: runtimeModelName(image.model),
        initContainerName: String(resolution.workload.initContainerName || ""),
        runtimeContainerName: "triton",
        legacyImage: image.reference,
        runtimeTemplateId: resolution.action === "CREATE"
          ? String(resolution.runtimeTemplate.id)
          : String(resolution.workload.runtimeTemplateId || ""),
      },
    },
  };
}

function labelValue(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9](?:[-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/.test(normalized)) {
    throw new ModelDeploymentError(400, `${field} must be a Kubernetes label value`);
  }
  return normalized;
}

export function modelDeploymentIdentity(input: ModelPublishRequest): Record<string, string> {
  return {
    [identityKeys.managedBy]: "bams",
    [identityKeys.source]: input.source,
    [identityKeys.spaceId]: labelValue(input.spaceId, "spaceId"),
    [identityKeys.modelRepoId]: labelValue(input.modelRepoId, "modelRepoId"),
    [identityKeys.edgeUnit]: labelValue(input.edgeUnit, "edgeUnit"),
  };
}

export function deterministicModelDeploymentName(input: ModelPublishRequest): string {
  const identity = `${input.source}:${input.spaceId}:${input.modelRepoId}:${input.edgeUnit}`;
  return `bams-model-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

function modelAnnotations(input: ModelPublishRequest, operation: "creating" | "updating", initContainerName: string, template?: ReturnType<typeof resolveModelRuntimeTemplate>) {
  return {
    [annotationKeys.modelImageId]: input.modelImageId,
    [annotationKeys.modelVersionId]: input.modelVersionId,
    ...(template ? {
      [annotationKeys.runtimeTemplate]: template.id,
      [annotationKeys.runtimeTemplateVersion]: template.version,
    } : {}),
    [annotationKeys.modelInitContainer]: initContainerName,
    [annotationKeys.publishOperation]: operation,
  };
}

export function parseConfiguredModelImage(image: string, registry?: ModelRegistryConnection): { model: string; tag: string; reference: string } {
  const trimmed = image.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new ModelDeploymentError(400, "model image must not include a URL scheme");
  }
  const firstSlash = trimmed.indexOf("/");
  if (firstSlash <= 0) throw new ModelDeploymentError(400, "model image must include a registry host and repository");
  const normalizedImage = `${trimmed.slice(0, firstSlash).toLowerCase()}${trimmed.slice(firstSlash)}`;
  const prefix = modelImagePrefix(registry);
  if (!normalizedImage.startsWith(prefix)) {
    throw new ModelDeploymentError(400, "当前模型镜像不在边缘共享镜像仓库");
  }
  const relative = normalizedImage.slice(prefix.length);
  const separator = relative.lastIndexOf(":");
  if (separator <= 0 || separator === relative.length - 1 || relative.includes("@")) {
    throw new ModelDeploymentError(400, "model image must include a valid tag");
  }
  return { model: relative.slice(0, separator), tag: relative.slice(separator + 1), reference: normalizedImage };
}

function nodeArchitecture(node: any): string {
  return String(node?.status?.nodeInfo?.architecture || labelsOf(node)["kubernetes.io/arch"] || "").toLowerCase();
}

export function validatePublishTarget(node: any, input: ModelPublishRequest, architecture: string) {
  if (!node || nodeNameOf(node) !== input.targetId) throw new ModelDeploymentError(404, `Node ${input.targetId} not found`);
  if (!isExternalEdgeNode(node) || !nodeTargetsEdgeUnit(node, input.edgeUnit)) {
    throw new ModelDeploymentError(400, `Node ${input.targetId} does not belong to EdgeUnit ${input.edgeUnit}`);
  }
  if (!isNodeReady(node)) throw new ModelDeploymentError(400, `Node ${input.targetId} is not Ready`);
  if (nodeArchitecture(node) !== architecture) throw new ModelDeploymentError(400, `Node ${input.targetId} is not compatible with runtime architecture ${architecture}`);
}

function currentModelImage(deployment: any, containerName: string): string {
  const initContainers = deployment?.spec?.template?.spec?.initContainers;
  const container = Array.isArray(initContainers)
    ? initContainers.find((item: any) => item?.name === containerName)
    : undefined;
  if (!container?.image) throw new ModelDeploymentError(409, `managed Deployment has no ${containerName} initContainer`);
  return String(container.image);
}

function deploymentRef(item: any) {
  return {
    namespace: String(metadataOf(item).namespace || config.modelDeploymentNamespace),
    name: String(metadataOf(item).name || ""),
  };
}

function validateInput(input: ModelPublishRequest) {
  if (!input || input.source !== "bams") throw new ModelDeploymentError(400, "source must be bams");
  for (const field of ["spaceId", "modelRepoId", "modelVersionId", "modelImageId", "image", "edgeUnit"] as const) {
    if (typeof input[field] !== "string" || !input[field].trim()) throw new ModelDeploymentError(400, `${field} is required`);
  }
  const updatePolicy = input.updatePolicy || "LEGACY_IMAGE";
  if (updatePolicy !== "LEGACY_IMAGE" && updatePolicy !== "INCREMENTAL_RESTART") {
    throw new ModelDeploymentError(400, "unsupported model update policy");
  }
  if (updatePolicy === "INCREMENTAL_RESTART") validateIncrementalArtifact(input);
}

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;

function validateIncrementalArtifact(input: ModelPublishRequest) {
  if (!config.modelIncrementalSyncEnabled) {
    throw new ModelDeploymentError(400, "incremental model sync is not enabled for this BlueEdge installation");
  }
  const artifact = input.artifact;
  if (!artifact || typeof artifact !== "object") {
    throw new ModelDeploymentError(400, "artifact is required for incremental model sync");
  }
  if (!config.modelArtifactSchemaVersions.includes(artifact.schemaVersion)) {
    throw new ModelDeploymentError(400, `artifact schemaVersion ${artifact.schemaVersion} is not supported`);
  }
  for (const field of ["contentVersion", "manifestDigest"] as const) {
    if (typeof artifact[field] !== "string" || !sha256DigestPattern.test(artifact[field])) {
      throw new ModelDeploymentError(400, `artifact.${field} must be a sha256 digest`);
    }
  }
  if (typeof artifact.artifactRef !== "string" || !/@sha256:[a-f0-9]{64}$/.test(artifact.artifactRef)) {
    throw new ModelDeploymentError(400, "artifact.artifactRef must be an immutable sha256 reference");
  }
  if (!Number.isSafeInteger(artifact.fileCount) || artifact.fileCount <= 0) {
    throw new ModelDeploymentError(400, "artifact.fileCount must be a positive integer");
  }
  if (!Number.isSafeInteger(artifact.totalBytes) || artifact.totalBytes <= 0) {
    throw new ModelDeploymentError(400, "artifact.totalBytes must be a positive integer");
  }
}

function validateArtifactRegistry(input: ModelPublishRequest, registry: ModelRegistryConnection) {
  if ((input.updatePolicy || "LEGACY_IMAGE") !== "INCREMENTAL_RESTART") return;
  const artifactRef = String(input.artifact?.artifactRef || "");
  const prefix = modelImagePrefix(registry);
  if (!artifactRef.toLowerCase().startsWith(prefix.toLowerCase())) {
    throw new ModelDeploymentError(400, "artifact.artifactRef is not in the configured EdgeUnit Registry");
  }
}

function runtimeModelName(repository: string) {
  const name = repository.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (!name) throw new ModelDeploymentError(400, "model repository cannot be converted to a runtime model name");
  return name;
}

function matchingInitContainers(deployment: any, repository: string, registry: ModelRegistryConnection) {
  const containers = deployment?.spec?.template?.spec?.initContainers;
  if (!Array.isArray(containers)) return [];
  return containers.filter((container: any) => {
    if (!container?.name || !container?.image) return false;
    try {
      return parseConfiguredModelImage(String(container.image), registry).model === repository;
    } catch {
      return false;
    }
  });
}

function resolvedInitContainer(deployment: any, repository: string, registry: ModelRegistryConnection, trustManagedAnnotation = false) {
  const annotatedName = String(metadataOf(deployment).annotations?.[annotationKeys.modelInitContainer] || "");
  const containers = deployment?.spec?.template?.spec?.initContainers;
  if (annotatedName && Array.isArray(containers)) {
    const annotated = containers.find((item: any) => item?.name === annotatedName);
    if (annotated?.image) {
      // Identity labels plus this annotation are the contract created by BAMS.
      // The previous image may legitimately use an older Registry alias or a
      // different repository name, so it must not be parsed against the new
      // EdgeUnit Registry before we replace it.
      if (trustManagedAnnotation) return annotated;
      try {
        const parsed = parseConfiguredModelImage(String(annotated.image), registry);
        if (parsed.model === repository) return annotated;
      } catch {
        // Fall through to strict repository resolution for legacy Deployments.
      }
    }
    if (trustManagedAnnotation) {
      throw new ModelDeploymentError(409, `managed Deployment ${metadataOf(deployment).name} has no annotated model initContainer ${annotatedName}`);
    }
  }
  const matches = matchingInitContainers(deployment, repository, registry);
  if (matches.length !== 1) {
    throw new ModelDeploymentError(409, matches.length > 1
      ? `Deployment ${metadataOf(deployment).name} has multiple initContainers for repository ${repository}`
      : `Deployment ${metadataOf(deployment).name} has no initContainer for repository ${repository}`);
  }
  return matches[0];
}

function activeNode(deployment: any, pods: any[]) {
  const pinned = String(deployment?.spec?.template?.spec?.nodeName || "");
  if (pinned) return pinned;
  const activePod = pods.find((pod) => !metadataOf(pod).deletionTimestamp && pod?.status?.phase !== "Succeeded" && pod?.spec?.nodeName);
  return String(activePod?.spec?.nodeName || "");
}

function workloadSummary(deployment: any, repository: string, pods: any[], registry: ModelRegistryConnection, trustManagedAnnotation = false) {
  const ref = deploymentRef(deployment);
  const persistent = persistentModelMetadata(deployment, runtimeModelName(repository));
  if (persistent) {
    if (!persistent.initContainerName || !persistent.legacyImage) {
      throw new ModelDeploymentError(409, `managed Deployment ${metadataOf(deployment).name} has incomplete persistent model metadata`);
    }
    const separator = persistent.legacyImage.lastIndexOf(":");
    return {
      ...ref,
      initContainerName: persistent.initContainerName,
      currentImage: persistent.legacyImage,
      currentVersion: separator >= 0 ? persistent.legacyImage.slice(separator + 1) : "",
      targetNode: activeNode(deployment, pods),
      runtimeTemplateId: String(metadataOf(deployment).annotations?.[annotationKeys.runtimeTemplate] || ""),
      runtime: Array.isArray(deployment?.spec?.template?.spec?.containers)
        ? deployment.spec.template.spec.containers.map((container: any) => ({
          name: String(container?.name || ""), image: String(container?.image || ""),
          command: container?.command || [], args: container?.args || [],
        })) : [],
      persistentModel: persistent,
    };
  }
  const initContainer = resolvedInitContainer(deployment, repository, registry, trustManagedAnnotation);
  const currentImage = String(initContainer.image);
  let currentVersion = "";
  if (trustManagedAnnotation) {
    const lastSlash = currentImage.lastIndexOf("/");
    const separator = currentImage.lastIndexOf(":");
    if (separator > lastSlash && separator < currentImage.length - 1) currentVersion = currentImage.slice(separator + 1);
  } else {
    currentVersion = parseConfiguredModelImage(currentImage, registry).tag;
  }
  const runtimeContainers = Array.isArray(deployment?.spec?.template?.spec?.containers)
    ? deployment.spec.template.spec.containers.map((container: any) => ({
      name: String(container?.name || ""),
      image: String(container?.image || ""),
      command: container?.command || [],
      args: container?.args || [],
    }))
    : [];
  return {
    ...ref,
    initContainerName: String(initContainer.name),
    currentImage,
    currentVersion,
    targetNode: activeNode(deployment, pods),
    runtimeTemplateId: String(metadataOf(deployment).annotations?.[annotationKeys.runtimeTemplate] || ""),
    runtime: runtimeContainers,
  };
}

function compatibleNodes(nodes: any[], edgeUnit: string, architecture: string) {
  return nodes
    .filter((node) => isExternalEdgeNode(node) && nodeTargetsEdgeUnit(node, edgeUnit) && isNodeReady(node) && nodeArchitecture(node) === architecture)
    .map((node) => ({ name: nodeNameOf(node), status: "Ready", architecture: nodeArchitecture(node) }));
}

function requestedRuntimeTemplate(input: Pick<ModelPublishRequest, "predictFramework" | "runtimeTemplateId">) {
  return resolveModelRuntimeTemplate(
    input.runtimeTemplateId?.trim() || runtimeTemplateIdForPredictFramework(input.predictFramework),
  );
}

export async function resolveModelDeploymentWithDependencies(input: ModelPublishRequest, dependencies: PublishDependencies) {
  validateInput(input);
  if (!await dependencies.edgeUnitExists(input.edgeUnit)) throw new ModelDeploymentError(404, `EdgeUnit ${input.edgeUnit} not found`);
  const registryConfig = await dependencies.getModelRegistry(input.edgeUnit);
  if (!registryConfig.enabled) throw new ModelDeploymentError(400, `EdgeUnit ${input.edgeUnit} model Registry is disabled`);
  const registry = edgeUnitRegistryConnection(registryConfig);
  validateArtifactRegistry(input, registry);
  const image = parseConfiguredModelImage(input.image, registry);
  const labels = modelDeploymentIdentity(input);
  const managed = await dependencies.listManagedDeployments(labels);
  if (managed.length > 1) throw new ModelDeploymentError(409, "multiple managed model Deployments match this BAMS model and EdgeUnit");
  let existing = managed[0];
  let matchedBy: "identity" | "repository" = "identity";
  if (!existing) {
    matchedBy = "repository";
    const candidates = (await dependencies.listEdgeUnitDeployments(input.edgeUnit))
      .filter((deployment) => labelsOf(deployment)[identityKeys.managedBy] !== "bams")
      .flatMap((deployment) => matchingInitContainers(deployment, image.model, registry).map(() => deployment));
    if (candidates.length > 1) throw new ModelDeploymentError(409, `multiple legacy Deployments contain initContainer repository ${image.model}`);
    existing = candidates[0];
  }
  if (existing) {
    const pods = await dependencies.listPods(existing);
    return {
      action: "UPDATE" as const,
      matchedBy,
      repository: image.model,
      workload: workloadSummary(existing, image.model, pods, registry, matchedBy === "identity"),
      status: modelDeploymentStatus(existing, pods),
      capabilities: modelIncrementalCapabilities(),
      registry: registryConfig,
    };
  }
  const template = requestedRuntimeTemplate(input);
  return {
    action: "CREATE" as const,
    repository: image.model,
    runtimeTemplate: {
      id: template.id,
      version: template.version,
      architecture: template.architecture,
      artifactSourcePath: template.artifactSourcePath,
      runtimeContainerName: template.runtimeContainerName,
    },
    nodes: compatibleNodes(await dependencies.listNodes(), input.edgeUnit, template.architecture),
    capabilities: modelIncrementalCapabilities(),
    registry: registryConfig,
  };
}

export async function publishModelDeploymentWithDependencies(input: ModelPublishRequest, dependencies: PublishDependencies) {
  validateInput(input);
  const registryConfig = await dependencies.getModelRegistry(input.edgeUnit);
  if (!registryConfig.enabled) throw new ModelDeploymentError(400, `EdgeUnit ${input.edgeUnit} model Registry is disabled`);
  const registry = edgeUnitRegistryConnection(registryConfig);
  validateArtifactRegistry(input, registry);
  const image = parseConfiguredModelImage(input.image, registry);
  const resolution = await resolveModelDeploymentWithDependencies(input, dependencies);
  if ((input.updatePolicy || "LEGACY_IMAGE") === "INCREMENTAL_RESTART") {
    if (resolution.action !== "UPDATE") {
      throw new ModelDeploymentError(400, "the first model publish must use LEGACY_IMAGE before incremental updates");
    }
    if (!config.modelSyncExecutorImage) {
      throw new ModelDeploymentError(400, "MODEL_SYNC_EXECUTOR_IMAGE is not configured");
    }
    const targetNode = resolution.action === "UPDATE"
      ? String(resolution.workload.targetNode || "")
      : String(input.targetId || "");
    if (!targetNode) throw new ModelDeploymentError(400, "target node is required for incremental model sync");
    const namespace = config.modelDeploymentNamespace;
    const pullSecret = registryConfig.pullSecretName;
    if (!pullSecret || !await dependencies.secretExists(namespace, pullSecret)) {
      throw new ModelDeploymentError(400, `imagePullSecret ${pullSecret || "<empty>"} is missing or invalid in namespace ${namespace}`);
    }
    const created = await dependencies.createModelSyncTask(
      namespace,
      buildModelSyncTask(input, resolution, image, targetNode),
    );
    return {
      action: resolution.action,
      mode: "INCREMENTAL_RESTART" as const,
      taskId: String(metadataOf(created.item).name || ""),
      state: String(created.item?.status?.phase || "PENDING"),
      idempotent: created.idempotent,
      item: created.item,
    };
  }
  if (resolution.action === "UPDATE") {
    const existing = (await dependencies.listManagedDeployments(modelDeploymentIdentity(input)))[0]
      || (await dependencies.listEdgeUnitDeployments(input.edgeUnit)).find((deployment) =>
        metadataOf(deployment).namespace === resolution.workload.namespace && metadataOf(deployment).name === resolution.workload.name);
    if (!existing) throw new ModelDeploymentError(409, "resolved model Deployment changed before update");
    if ("persistentModel" in resolution.workload && resolution.workload.persistentModel) {
      const restored = await dependencies.restoreLegacyImage(
        resolution.workload.namespace,
        resolution.workload.name,
        image.reference,
        modelAnnotations(input, "updating", resolution.workload.initContainerName),
      );
      return { action: "UPDATE" as const, item: restored, change: { image: image.reference }, status: modelDeploymentStatus(restored, []) };
    }
    if (resolution.workload.currentImage === image.reference) {
      return { action: "UPDATE" as const, idempotent: true, item: existing, status: resolution.status };
    }
    const updated = await dependencies.updateImage(resolution.workload.namespace, resolution.workload.name, {
      containerName: resolution.workload.initContainerName,
      model: image.model,
      tag: image.tag,
      expectedCurrentImage: resolution.workload.currentImage,
    }, modelAnnotations(input, "updating", resolution.workload.initContainerName), registryConfig);
    return { action: "UPDATE" as const, item: updated.item, change: updated.change, status: modelDeploymentStatus(updated.item, []) };
  }

  if (input.targetType !== "node" || !input.targetId) throw new ModelDeploymentError(400, "targetType and targetId are required for CREATE");
  const template = resolveModelRuntimeTemplate(resolution.runtimeTemplate.id);
  const node = await dependencies.getNode(input.targetId);
  validatePublishTarget(node, input, template.architecture);
  const namespace = config.modelDeploymentNamespace;
  const pullSecret = registryConfig.pullSecretName;
  if (!pullSecret || !await dependencies.secretExists(namespace, pullSecret)) {
    throw new ModelDeploymentError(400, `imagePullSecret ${pullSecret || "<empty>"} is missing or invalid in namespace ${namespace}`);
  }
  const labels = modelDeploymentIdentity(input);
  const modelName = runtimeModelName(image.model);
  const initContainerName = `${modelName}-model-copy`;

  {
    const name = deterministicModelDeploymentName(input);
    const deployment = buildTritonDeployment({
      name,
      namespace,
      image: modelImageReference(image.model, image.tag, registry),
      modelName,
      initContainerName,
      targetNode: input.targetId,
      edgeUnit: input.edgeUnit,
      labels,
      annotations: modelAnnotations(input, "creating", initContainerName, template),
      pullSecret,
      template,
    });
    try {
      const item = await dependencies.createDeployment(namespace, deployment);
      return { action: "CREATE" as const, item, status: modelDeploymentStatus(item, []) };
    } catch (error) {
      if (!/409|AlreadyExists/i.test(error instanceof Error ? error.message : "")) throw error;
      const matches = await dependencies.listManagedDeployments(labels);
      if (matches.length !== 1) throw new ModelDeploymentError(409, "concurrent model Deployment creation conflict");
      const racedImage = currentModelImage(matches[0], initContainerName);
      if (racedImage === image.reference) {
        return { action: "CREATE" as const, idempotent: true, item: matches[0], status: modelDeploymentStatus(matches[0], []) };
      }
      throw new ModelDeploymentError(409, "another model version was published concurrently; refresh status before retrying");
    }
  }
}

function selectorQuery(labels: Record<string, string>): string {
  return encodeURIComponent(Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(","));
}

const productionDependencies: PublishDependencies = {
  async edgeUnitExists(edgeUnit) {
    const configMaps = await getEdgeUnitConfigMaps([]);
    return configMaps.some((item) => edgeUnitConfigMapMatches(item, edgeUnit));
  },
  async getModelRegistry(edgeUnit) {
    try {
      return await resolveEdgeUnitModelRegistry(edgeUnit);
    } catch (error) {
      const message = error instanceof Error ? error.message : "model Registry is not configured";
      throw new ModelDeploymentError(/not found/i.test(message) ? 404 : 400, message);
    }
  },
  getNode(name) {
    return getK8sJson(`/api/v1/nodes/${encodeURIComponent(name)}`);
  },
  async listNodes() {
    return itemsOf(await getK8sJson("/api/v1/nodes"));
  },
  async listPods(deployment) {
    const ref = deploymentRef(deployment);
    const selector = deployment?.spec?.selector?.matchLabels || {};
    return itemsOf(await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(ref.namespace)}/pods?labelSelector=${selectorQuery(selector)}`));
  },
  async secretExists(namespace, name) {
    try {
      const secret = await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`);
      return secret?.type === "kubernetes.io/dockerconfigjson"
        && typeof secret?.data?.[".dockerconfigjson"] === "string"
        && secret.data[".dockerconfigjson"].length > 0;
    } catch (error) {
      if (/404|not found/i.test(error instanceof Error ? error.message : "")) return false;
      throw error;
    }
  },
  async listManagedDeployments(labels) {
    const result = await getK8sJson(`/apis/apps/v1/deployments?labelSelector=${selectorQuery(labels)}`);
    return itemsOf(result);
  },
  async listEdgeUnitDeployments(edgeUnit) {
    const result = await getK8sJson(`/apis/apps/v1/deployments?labelSelector=${selectorQuery({ [identityKeys.edgeUnit]: labelValue(edgeUnit, "edgeUnit") })}`);
    return itemsOf(result);
  },
  createDeployment(namespace, deployment) {
    return requestK8sJson(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments`, { method: "POST", body: deployment });
  },
  async updateImage(namespace, name, payload, annotations, registryConfig) {
    const [credential, ca] = await Promise.all([
      readEdgeUnitRegistryCredential(registryConfig),
      readEdgeUnitRegistryCa(registryConfig),
    ]);
    return updateModelImage(namespace, name, payload, {
      deploymentAnnotations: annotations,
      registry: edgeUnitRegistryConnection(registryConfig, credential, ca?.pem),
    });
  },
  createModelSyncTask,
  async restoreLegacyImage(namespace, name, image, annotations) {
    const path = `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`;
    const deployment = await getK8sJson(path);
    return requestK8sJson(path, {
      method: "PUT",
      body: restoreLegacyModelDeployment(deployment, image, annotations),
    });
  },
};

export function publishModelDeployment(input: ModelPublishRequest) {
  return publishModelDeploymentWithDependencies(input, productionDependencies);
}

export function resolveModelDeployment(input: ModelPublishRequest) {
  return resolveModelDeploymentWithDependencies(input, productionDependencies);
}

export function readModelSyncTask(namespace: string, name: string) {
  return getModelSyncTask(namespace, name);
}

export async function getModelRegistryTarget(edgeUnit: string) {
  const registry = await resolveEdgeUnitModelRegistry(edgeUnit);
  const connection = edgeUnitRegistryConnection(registry);
  return {
    enabled: registry.enabled,
    registryHost: registry.registryHost,
    repositoryPrefix: registry.repositoryPrefix,
    imagePrefix: modelImagePrefix(connection),
    tls: registry.tls,
  };
}

export async function listModelPublishEdgeUnits() {
  const configMaps = await getEdgeUnitConfigMaps([]);
  return { items: configMaps.map((item) => ({ name: String(item?.data?.name || labelsOf(item)[identityKeys.edgeUnit] || metadataOf(item).name || "") })).filter((item) => item.name) };
}

export async function listModelPublishNodes(edgeUnit: string, runtimeTemplateId?: string) {
  const template = resolveModelRuntimeTemplate(runtimeTemplateId || "triton-work-amd64");
  const configMaps = await getEdgeUnitConfigMaps([]);
  if (!configMaps.some((item) => edgeUnitConfigMapMatches(item, edgeUnit))) throw new ModelDeploymentError(404, `EdgeUnit ${edgeUnit} not found`);
  const nodes = itemsOf(await getK8sJson("/api/v1/nodes"));
  return {
    runtimeTemplate: template,
    items: compatibleNodes(nodes, edgeUnit, template.architecture),
  };
}

function waitingFailure(status: any): string | null {
  const statuses = [
    ...(Array.isArray(status?.initContainerStatuses) ? status.initContainerStatuses : []),
    ...(Array.isArray(status?.containerStatuses) ? status.containerStatuses : []),
  ];
  for (const item of statuses) {
    const waiting = item?.state?.waiting;
    if (["ImagePullBackOff", "ErrImagePull", "CrashLoopBackOff"].includes(String(waiting?.reason || ""))) {
      return `${waiting.reason}${waiting.message ? `: ${waiting.message}` : ""}`;
    }
    const terminated = item?.state?.terminated;
    if (terminated && Number(terminated.exitCode) !== 0) return `${item.name} exited with code ${terminated.exitCode}`;
  }
  return null;
}

export function modelDeploymentStatus(deployment: any, pods: any[]) {
  const generation = Number(metadataOf(deployment).generation || 0);
  const observedGeneration = Number(deployment?.status?.observedGeneration || 0);
  const desired = Number(deployment?.spec?.replicas ?? 1);
  const status = deployment?.status || {};
  const deploymentFailure = Array.isArray(status.conditions)
    ? status.conditions.find((condition: any) =>
      (condition?.type === "Progressing" && condition?.status === "False" && condition?.reason === "ProgressDeadlineExceeded")
      || (condition?.type === "ReplicaFailure" && condition?.status === "True"))
    : undefined;
  if (deploymentFailure && observedGeneration >= generation) {
    return {
      state: "FAILED",
      message: `${deploymentFailure.reason || deploymentFailure.type}${deploymentFailure.message ? `: ${deploymentFailure.message}` : ""}`,
    };
  }
  const activePods = pods.filter((pod) => !metadataOf(pod).deletionTimestamp && pod?.status?.phase !== "Succeeded");
  for (const pod of activePods) {
    const failure = waitingFailure(pod?.status);
    if (failure) return { state: "FAILED", message: failure };
    const scheduled = Array.isArray(pod?.status?.conditions)
      ? pod.status.conditions.find((condition: any) => condition?.type === "PodScheduled" && condition?.status === "False")
      : undefined;
    if (scheduled?.reason === "Unschedulable") return { state: "FAILED", message: `FailedScheduling: ${scheduled.message || "unschedulable"}` };
    if (pod?.status?.phase === "Failed") return { state: "FAILED", message: pod?.status?.message || "Pod failed" };
  }
  const readyPods = activePods.filter((pod) => pod?.status?.phase === "Running" && Array.isArray(pod?.status?.conditions)
    && pod.status.conditions.some((condition: any) => condition?.type === "Ready" && condition?.status === "True")).length;
  const ready = observedGeneration >= generation
    && Number(status.replicas || 0) >= desired
    && Number(status.updatedReplicas || 0) >= desired
    && Number(status.availableReplicas || 0) >= desired
    && Number(status.unavailableReplicas || 0) === 0
    && readyPods >= desired;
  if (ready) return { state: "READY", message: "Deployment and Pods are Ready" };
  const operation = String(metadataOf(deployment).annotations?.[annotationKeys.publishOperation] || "creating");
  return { state: operation === "updating" ? "UPDATING" : "CREATING", message: "Deployment rollout is in progress" };
}

export async function getModelDeploymentStatus(namespace: string, name: string) {
  const deployment = await getK8sJson(`/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`);
  const selector = selectorQuery(deployment?.spec?.selector?.matchLabels || {});
  const pods = itemsOf(await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${selector}`));
  return { item: { namespace, name, ...modelDeploymentStatus(deployment, pods), deployment } };
}

export async function findModelDeploymentStatus(spaceId: string, modelRepoId: string, edgeUnit: string, image: string) {
  const resolution = await resolveModelDeployment({
    source: "bams",
    spaceId,
    modelRepoId,
    modelVersionId: "status",
    modelImageId: "status",
    image,
    edgeUnit,
  });
  if (resolution.action === "CREATE") return { item: { state: "NOT_PUBLISHED" } };
  return { item: { ...resolution.workload, ...resolution.status } };
}
