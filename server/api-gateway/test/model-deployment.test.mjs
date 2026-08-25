import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../dist/config.js";
import {
  deterministicModelDeploymentName,
  modelDeploymentStatus,
  parseConfiguredModelImage,
  publishModelDeploymentWithDependencies,
  resolveModelDeploymentWithDependencies,
  modelIncrementalCapabilities,
} from "../dist/services/model-deployment.service.js";
import {
  applyModelArtifactMount,
  buildModelSyncJob,
  persistentModelMetadata,
  reconcileModelSyncTask,
  restoreLegacyModelDeployment,
} from "../dist/services/model-sync-controller.service.js";

const base = {
  source: "bams",
  spaceId: "space-1",
  modelRepoId: "repo-1",
  modelVersionId: "version-1",
  modelImageId: "image-1",
  image: "registry.example.com/app/face:1.0-amd64",
  predictFramework: "triton-amd64",
  edgeUnit: "edge-131",
  targetType: "node",
  targetId: "aibox-1",
};

const modelRegistry = {
  enabled: true,
  registryHost: "registry.example.com",
  repositoryPrefix: "app",
  tls: true,
  pullSecretName: "my-registry-secret",
  readCredentialRef: "",
  caSecretRef: "",
};

function node(overrides = {}) {
  return {
    metadata: {
      name: "aibox-1",
      labels: {
        "node-role.kubernetes.io/edge": "",
        "blueedge.io/edge-unit": "edge-131",
        "kubernetes.io/arch": "amd64",
        ...overrides.labels,
      },
    },
    status: {
      nodeInfo: { architecture: overrides.architecture || "amd64", kubeletVersion: "v1-kubeedge" },
      conditions: [{ type: "Ready", status: overrides.ready === false ? "False" : "True" }],
    },
  };
}

function managedDeployment(image = base.image, targetId = base.targetId, initContainerName = "face-model-copy") {
  return {
    metadata: {
      name: deterministicModelDeploymentName(base),
      namespace: "default",
      labels: {
        "blueedge.io/managed-by": "bams",
        "blueedge.io/source": "bams",
        "blueedge.io/bams-space-id": base.spaceId,
        "blueedge.io/bams-model-repo-id": base.modelRepoId,
        "blueedge.io/edge-unit": base.edgeUnit,
      },
      annotations: {},
    },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      template: {
        spec: {
          nodeName: targetId,
          initContainers: [{ name: initContainerName, image }],
          containers: [{ name: "triton", image: "triton:test" }],
        },
      },
    },
  };
}

function harness(options = {}) {
  let managedMatches = options.managedMatches || [];
  const edgeUnitDeployments = options.edgeUnitDeployments || [];
  const calls = { creates: [], updates: [] };
  return {
    calls,
    dependencies: {
      async edgeUnitExists() { return options.edgeUnitExists !== false; },
      async getModelRegistry() {
        if (options.registryError) throw options.registryError;
        return options.modelRegistry || modelRegistry;
      },
      async getNode() { return options.node || node(); },
      async listNodes() { return options.nodes || [node()]; },
      async listPods() { return options.pods || [{ spec: { nodeName: "aibox-1" }, status: { phase: "Running" } }]; },
      async secretExists() { return options.secretExists !== false; },
      async listManagedDeployments() { return managedMatches; },
      async listEdgeUnitDeployments() { return edgeUnitDeployments; },
      async createDeployment(_namespace, deployment) {
        calls.creates.push(deployment);
        if (options.createConflict) {
          managedMatches = [options.conflictDeployment || deployment];
          throw new Error("Kubernetes request failed: 409 AlreadyExists");
        }
        return deployment;
      },
      async updateImage(namespace, name, payload, annotations) {
        calls.updates.push({ namespace, name, payload, annotations });
        if (options.updateError) throw options.updateError;
        const existing = managedMatches[0] || edgeUnitDeployments[0];
        const item = structuredClone(existing);
        item.spec.template.spec.initContainers.find((container) => container.name === payload.containerName).image = base.image;
        item.metadata.annotations = { ...item.metadata.annotations, ...annotations };
        return { item, change: { previousImage: payload.expectedCurrentImage, image: base.image } };
      },
      async createModelSyncTask(_namespace, resource) {
        calls.syncTasks = calls.syncTasks || [];
        calls.syncTasks.push(resource);
        return { item: resource, idempotent: options.syncTaskIdempotent === true };
      },
      async restoreLegacyImage(namespace, name, image, annotations) {
        calls.restores = calls.restores || [];
        calls.restores.push({ namespace, name, image, annotations });
        const existing = managedMatches[0];
        return restoreLegacyModelDeployment(existing, image, annotations);
      },
    },
  };
}

test.before(() => {
  config.modelRegistryUrl = "https://registry.example.com";
  config.modelRegistryPrefix = "app";
  config.modelDeploymentNamespace = "default";
  config.modelDeploymentPullSecret = "my-registry-secret";
  config.tritonAmd64RuntimeImage = "registry.example.com/runtime/triton:26.03";
  config.tritonArm64RuntimeImage = "registry.example.com/runtime/triton-arm64:26.03";
  config.modelSyncExecutorImage = "registry.example.com/blueedge/model-sync:v1";
  config.modelSyncControllerEnabled = true;
});

test("incremental model publishing is capability-gated and creates a durable sync task", async () => {
  const incremental = {
    ...base,
    predictFramework: "triton-bams-amd64",
    updatePolicy: "INCREMENTAL_RESTART",
    artifact: {
      schemaVersion: 1,
      contentVersion: `sha256:${"a".repeat(64)}`,
      manifestDigest: `sha256:${"b".repeat(64)}`,
      artifactRef: `registry.example.com/app/face-artifacts@sha256:${"c".repeat(64)}`,
      fileCount: 3,
      totalBytes: 1024,
    },
  };

  config.modelIncrementalSyncEnabled = false;
  assert.deepEqual(modelIncrementalCapabilities().updatePolicies, ["LEGACY_IMAGE"]);
  await assert.rejects(
    () => resolveModelDeploymentWithDependencies(incremental, harness().dependencies),
    /incremental model sync is not enabled/,
  );

  config.modelIncrementalSyncEnabled = true;
  try {
    const existing = managedDeployment("registry.example.com/app/face:0.9-amd64");
    existing.metadata.annotations["blueedge.io/model-init-container"] = "face-model-copy";
    existing.metadata.annotations["blueedge.io/runtime-template"] = "triton-work-amd64";
    const h = harness({ managedMatches: [existing] });
    const resolved = await resolveModelDeploymentWithDependencies(incremental, h.dependencies);
    assert.equal(resolved.capabilities.incrementalSync, true);
    assert.deepEqual(resolved.capabilities.artifactSchemaVersions, [1]);
    const published = await publishModelDeploymentWithDependencies(incremental, h.dependencies);
    assert.equal(published.mode, "INCREMENTAL_RESTART");
    assert.equal(published.state, "PENDING");
    assert.match(published.taskId, /^model-sync-[a-f0-9]{20}$/);
    assert.equal(h.calls.syncTasks[0].spec.registry.url, "https://registry.example.com");
    assert.equal(h.calls.syncTasks[0].spec.deployment.initContainerName, "face-model-copy");
    await assert.rejects(
      () => resolveModelDeploymentWithDependencies({
        ...incremental,
        artifact: {
          ...incremental.artifact,
          artifactRef: `other.example.com/app/face@sha256:${"c".repeat(64)}`,
        },
      }, harness().dependencies),
      /not in the configured EdgeUnit Registry/,
    );
  } finally {
    config.modelIncrementalSyncEnabled = false;
  }
});

test("model sync Job is edge-pinned and Deployment switches only the selected model to persistent content", () => {
  const previousSkip = config.modelSyncRegistrySkipTlsVerify;
  config.modelSyncRegistrySkipTlsVerify = true;
  try {
    const deployment = managedDeployment("registry.example.com/app/face:0.9-amd64");
    deployment.spec.template.spec.initContainers.push({
      name: "embedding-model-copy", image: "registry.example.com/app/embedding:1.0",
    });
    deployment.spec.template.spec.containers[0].volumeMounts = [{ name: "model-repo", mountPath: "/model-repo" }];
    deployment.spec.template.spec.volumes = [{ name: "model-repo", emptyDir: {} }];
    const task = {
      metadata: { name: "model-sync-1234567890abcdef1234", namespace: "default", uid: "uid-1" },
      spec: {
        targetNode: "aibox-1",
        artifact: {
          contentVersion: `sha256:${"a".repeat(64)}`,
          artifactRef: `registry.example.com/app/face-artifacts@sha256:${"b".repeat(64)}`,
        },
        registry: { url: "https://registry.example.com", pullSecretName: "my-registry-secret" },
        deployment: {
          namespace: "default", name: deployment.metadata.name, modelName: "face",
          initContainerName: "face-model-copy", runtimeContainerName: "triton",
        },
      },
    };
    const job = buildModelSyncJob(task);
    assert.equal(job.spec.template.spec.nodeName, "aibox-1");
    assert.equal(job.spec.template.spec.containers[0].args.includes("--skip-tls-verify"), true);
    assert.equal(job.spec.template.spec.volumes[0].hostPath.type, "DirectoryOrCreate");
    const caTask = structuredClone(task);
    caTask.spec.registry.caSecretName = "model-registry-ca-test";
    const caJob = buildModelSyncJob(caTask);
    assert.equal(caJob.spec.template.spec.containers[0].args.includes("--ca-file"), true);
    assert.equal(caJob.spec.template.spec.containers[0].args.includes("--skip-tls-verify"), false);
    assert.equal(caJob.spec.template.spec.volumes.some((item) => item.secret?.secretName === "model-registry-ca-test"), true);

    const switched = applyModelArtifactMount(deployment, task);
    assert.equal(switched.spec.template.spec.nodeName, "aibox-1");
    assert.deepEqual(switched.spec.template.spec.initContainers.map((item) => item.name), ["embedding-model-copy"]);
    assert.equal(switched.spec.template.spec.volumes[0].name, "model-repo");
    const artifactMount = switched.spec.template.spec.containers[0].volumeMounts.find((item) => item.mountPath === "/model-repo/face");
    assert.equal(artifactMount.readOnly, true);
    assert.equal(persistentModelMetadata(switched, "face").legacyImage, "registry.example.com/app/face:0.9-amd64");

    const nextTask = structuredClone(task);
    nextTask.spec.artifact.contentVersion = `sha256:${"c".repeat(64)}`;
    nextTask.spec.artifact.artifactRef = `registry.example.com/app/face-artifacts@sha256:${"d".repeat(64)}`;
    const switchedAgain = applyModelArtifactMount(switched, nextTask);
    assert.equal(switchedAgain.metadata.annotations["blueedge.io/model-content-version"], nextTask.spec.artifact.contentVersion);
    const restored = restoreLegacyModelDeployment(switchedAgain, "registry.example.com/app/face:2.0", {
      "blueedge.io/bams-model-image-id": "next-image",
    });
    assert.equal(restored.spec.template.spec.initContainers[0].image, "registry.example.com/app/face:2.0");
    assert.equal(restored.spec.template.spec.volumes.some((item) => item.name.startsWith("model-artifact-")), false);
    assert.equal(restored.metadata.annotations["blueedge.io/model-store-name"], undefined);
  } finally {
    config.modelSyncRegistrySkipTlsVerify = previousSkip;
  }
});

test("a persistent model remains resolvable for later incremental updates and can return to legacy image mode", async () => {
  config.modelIncrementalSyncEnabled = true;
  try {
    const deployment = managedDeployment("registry.example.com/app/face:0.9-amd64");
    deployment.metadata.annotations["blueedge.io/model-init-container"] = "face-model-copy";
    deployment.spec.template.spec.containers[0].volumeMounts = [{ name: "model-repo", mountPath: "/model-repo" }];
    deployment.spec.template.spec.volumes = [{ name: "model-repo", emptyDir: {} }];
    const task = {
      spec: {
        targetNode: "aibox-1",
        artifact: {
          contentVersion: `sha256:${"a".repeat(64)}`,
          artifactRef: `registry.example.com/app/face-artifacts@sha256:${"b".repeat(64)}`,
        },
        deployment: {
          namespace: "default", name: deployment.metadata.name,
          modelName: "face", initContainerName: "face-model-copy", runtimeContainerName: "triton",
        },
      },
    };
    const persistent = applyModelArtifactMount(deployment, task);
    delete persistent.metadata.annotations["blueedge.io/model-init-container"];
    assert.equal(persistentModelMetadata(persistent, "face").initContainerName, "face-model-copy");
    const incremental = {
      ...base,
      updatePolicy: "INCREMENTAL_RESTART",
      artifact: {
        schemaVersion: 1,
        contentVersion: `sha256:${"c".repeat(64)}`,
        manifestDigest: `sha256:${"d".repeat(64)}`,
        artifactRef: `registry.example.com/app/face-artifacts@sha256:${"e".repeat(64)}`,
        fileCount: 3,
        totalBytes: 1024,
      },
    };
    const incrementalHarness = harness({ managedMatches: [persistent] });
    const published = await publishModelDeploymentWithDependencies(incremental, incrementalHarness.dependencies);
    assert.equal(published.mode, "INCREMENTAL_RESTART");
    assert.equal(incrementalHarness.calls.syncTasks.length, 1);

    const legacyHarness = harness({ managedMatches: [persistent] });
    const legacy = await publishModelDeploymentWithDependencies({ ...base, image: "registry.example.com/app/face:2.0" }, legacyHarness.dependencies);
    assert.equal(legacy.action, "UPDATE");
    assert.equal(legacyHarness.calls.restores[0].image, "registry.example.com/app/face:2.0");
  } finally {
    config.modelIncrementalSyncEnabled = false;
  }
});

test("model sync reconcile persists every phase and completes after the rollout is Ready", async () => {
  const deployment = managedDeployment("registry.example.com/app/face:0.9-amd64");
  deployment.metadata.generation = 3;
  deployment.spec.selector = { matchLabels: { app: "face" } };
  deployment.spec.template.spec.containers[0].volumeMounts = [{ name: "model-repo", mountPath: "/model-repo" }];
  deployment.spec.template.spec.volumes = [{ name: "model-repo", emptyDir: {} }];
  deployment.status = { observedGeneration: 3, updatedReplicas: 1, availableReplicas: 1 };
  let currentDeployment = deployment;
  let job = { spec: { backoffLimit: 2 }, status: {} };
  const statusWrites = [];
  const task = {
    metadata: { name: "model-sync-1234567890abcdef1234", namespace: "default", uid: "uid-1", generation: 1 },
    spec: {
      targetNode: "aibox-1",
      artifact: {
        contentVersion: `sha256:${"a".repeat(64)}`,
        artifactRef: `registry.example.com/app/face-artifacts@sha256:${"b".repeat(64)}`,
      },
      registry: { url: "https://registry.example.com", pullSecretName: "my-registry-secret" },
      deployment: {
        namespace: "default", name: deployment.metadata.name, modelName: "face",
        initContainerName: "face-model-copy", runtimeContainerName: "triton",
      },
    },
  };
  const dependencies = {
    async listTasks() { return []; },
    async updateTaskStatus(item, nextStatus) {
      item.status = structuredClone(nextStatus);
      statusWrites.push(nextStatus.phase);
      return item;
    },
    async createJob() { return job; },
    async getJob() { return job; },
    async getDeployment() { return structuredClone(currentDeployment); },
    async updateDeployment(_namespace, _name, next) {
      currentDeployment = structuredClone(next);
      return next;
    },
    async listDeploymentPods() {
      return [{ metadata: { name: "face-ready" }, status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } }];
    },
    async ensureRegistryCa() {},
    now() { return new Date("2026-08-25T00:00:00.000Z"); },
  };

  await reconcileModelSyncTask(task, dependencies);
  assert.equal(task.status.phase, "SYNCING");
  job = { spec: { backoffLimit: 2 }, status: { succeeded: 1 } };
  await reconcileModelSyncTask(task, dependencies);
  assert.equal(task.status.phase, "SWITCHING");
  assert.ok(task.status.rollback.deployment.spec);
  await reconcileModelSyncTask(task, dependencies);
  assert.equal(task.status.phase, "SUCCEEDED");
  assert.deepEqual(statusWrites, ["SYNCING", "SWITCHING", "SUCCEEDED"]);
});

test("model sync reconcile restores the saved Deployment when rollout fails", async () => {
  const original = managedDeployment("registry.example.com/app/face:0.9-amd64");
  original.spec.selector = { matchLabels: { app: "face" } };
  const broken = structuredClone(original);
  broken.metadata.generation = 4;
  broken.status = {
    observedGeneration: 4,
    conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded", message: "not ready" }],
  };
  const task = {
    metadata: { name: "model-sync-rollback000000", namespace: "default", generation: 1 },
    spec: { deployment: { namespace: "default", name: original.metadata.name } },
    status: {
      phase: "SWITCHING", switchedAt: "2026-08-25T00:00:00.000Z",
      rollback: { deployment: { annotations: original.metadata.annotations, spec: original.spec } },
    },
  };
  let current = broken;
  const dependencies = {
    async listTasks() { return []; },
    async updateTaskStatus(item, nextStatus) { item.status = structuredClone(nextStatus); return item; },
    async createJob() {}, async getJob() {},
    async getDeployment() { return structuredClone(current); },
    async updateDeployment(_namespace, _name, next) { current = structuredClone(next); return next; },
    async listDeploymentPods() { return []; },
    async ensureRegistryCa() {},
    now() { return new Date("2026-08-25T00:01:00.000Z"); },
  };
  await reconcileModelSyncTask(task, dependencies);
  assert.equal(task.status.phase, "ROLLING_BACK");
  assert.deepEqual(current.spec, original.spec);
  current.metadata.generation = 5;
  current.status = { observedGeneration: 5, updatedReplicas: 1, availableReplicas: 1 };
  dependencies.listDeploymentPods = async () => [{
    metadata: { name: "restored" }, status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
  }];
  await reconcileModelSyncTask(task, dependencies);
  assert.equal(task.status.phase, "FAILED");
  assert.equal(task.status.rollbackState, "SUCCEEDED");
});

test("first publish creates the verified /work Triton runtime contract with parameterized names", async () => {
  const h = harness();
  const result = await publishModelDeploymentWithDependencies(base, h.dependencies);
  assert.equal(result.action, "CREATE");
  assert.equal(h.calls.creates.length, 1);
  const deployment = h.calls.creates[0];
  assert.equal(deployment.spec.template.spec.nodeName, "aibox-1");
  assert.equal(deployment.spec.template.spec.nodeSelector, undefined);
  assert.equal(deployment.spec.template.spec.affinity, undefined);
  assert.equal(deployment.spec.template.spec.initContainers[0].image, base.image);
  assert.equal(deployment.spec.template.spec.initContainers[0].name, "face-model-copy");
  assert.equal(deployment.spec.template.spec.initContainers[0].args[0].includes("cp -a /work/. /model-repo/face/"), true);
  assert.equal(deployment.spec.template.spec.containers[0].name, "triton");
  assert.deepEqual(deployment.spec.template.spec.volumes, [{ name: "model-repo", emptyDir: {} }]);
  assert.deepEqual(deployment.spec.template.spec.imagePullSecrets, [{ name: "my-registry-secret" }]);
  assert.deepEqual(deployment.spec.template.spec.tolerations, [{ key: "node-role.kubernetes.io/edge", operator: "Exists", effect: "NoSchedule" }]);
  assert.equal(deployment.metadata.labels["blueedge.io/bams-model-repo-id"], base.modelRepoId);
  assert.equal(deployment.metadata.annotations["blueedge.io/bams-model-image-id"], base.modelImageId);
});

test("ARM64 BAMS framework selects the ARM64 runtime template and only exposes ARM64 Nodes", async () => {
  const armNode = node({ architecture: "arm64", labels: { "kubernetes.io/arch": "arm64" } });
  const input = { ...base, predictFramework: "triton-bams-arm64", targetId: "aibox-1" };
  const resolved = await resolveModelDeploymentWithDependencies(input, harness({ nodes: [node(), armNode] }).dependencies);
  assert.equal(resolved.action, "CREATE");
  assert.equal(resolved.runtimeTemplate.id, "triton-work-arm64");
  assert.equal(resolved.runtimeTemplate.architecture, "arm64");
  assert.deepEqual(resolved.nodes.map((item) => item.name), ["aibox-1"]);

  const h = harness({ node: armNode, nodes: [armNode] });
  const result = await publishModelDeploymentWithDependencies(input, h.dependencies);
  assert.equal(result.action, "CREATE");
  assert.equal(h.calls.creates[0].spec.template.spec.containers[0].image, config.tritonArm64RuntimeImage);
  assert.equal(h.calls.creates[0].metadata.annotations["blueedge.io/runtime-template"], "triton-work-arm64");
});

test("ARM64 CREATE fails closed when its real Triton runtime image is not configured", async () => {
  const originalImage = config.tritonArm64RuntimeImage;
  const armNode = node({ architecture: "arm64", labels: { "kubernetes.io/arch": "arm64" } });
  const input = { ...base, predictFramework: "triton-bams-arm64" };
  config.tritonArm64RuntimeImage = "";
  try {
    await assert.rejects(
      () => publishModelDeploymentWithDependencies(input, harness({ node: armNode }).dependencies),
      /TRITON_ARM64_RUNTIME_IMAGE must use an explicit non-latest tag/,
    );
  } finally {
    config.tritonArm64RuntimeImage = originalImage;
  }
});

test("create fails closed when the pinned Triton runtime image is not configured", async () => {
  const originalImage = config.tritonAmd64RuntimeImage;
  config.tritonAmd64RuntimeImage = "";
  try {
    await assert.rejects(() => publishModelDeploymentWithDependencies(base, harness().dependencies), /explicit non-latest tag/);
    config.tritonAmd64RuntimeImage = "registry.example.com/runtime/triton:latest";
    await assert.rejects(() => publishModelDeploymentWithDependencies(base, harness().dependencies), /explicit non-latest tag/);
  } finally {
    config.tritonAmd64RuntimeImage = originalImage;
  }
});

test("UPDATE reuses the resolved existing initContainer and does not require predictFramework or Node input", async () => {
  const previous = managedDeployment("registry.example.com/app/face:0.9-amd64", "aibox-1", "legacy-face-copy");
  previous.metadata.annotations["blueedge.io/model-init-container"] = "legacy-face-copy";
  const h = harness({ managedMatches: [previous] });
  const result = await publishModelDeploymentWithDependencies({ ...base, predictFramework: "triton-dce-arm64", targetType: undefined, targetId: undefined }, h.dependencies);
  assert.equal(result.action, "UPDATE");
  assert.equal(h.calls.creates.length, 0);
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.updates[0].payload.expectedCurrentImage, "registry.example.com/app/face:0.9-amd64");
  assert.equal(h.calls.updates[0].payload.containerName, "legacy-face-copy");
  assert.equal(previous.spec.template.spec.nodeName, "aibox-1");
  assert.equal(result.item.spec.template.spec.nodeName, "aibox-1");
  assert.equal(result.item.spec.strategy.type, "Recreate");
});

test("managed identity UPDATE may replace the model image repository through its annotated initContainer", async () => {
  const previous = managedDeployment("183.95.195.121:31438/app/cat-dog-classifier:1.0-arm64-demo", "aibox-1", "cat-dog-classifier-model-copy");
  previous.metadata.annotations["blueedge.io/model-init-container"] = "cat-dog-classifier-model-copy";
  const h = harness({ managedMatches: [previous] });
  const result = await publishModelDeploymentWithDependencies(base, h.dependencies);
  assert.equal(result.action, "UPDATE");
  assert.equal(h.calls.updates.length, 1);
  assert.equal(h.calls.updates[0].payload.containerName, "cat-dog-classifier-model-copy");
  assert.equal(h.calls.updates[0].payload.model, "face");
  assert.equal(h.calls.updates[0].payload.expectedCurrentImage, "183.95.195.121:31438/app/cat-dog-classifier:1.0-arm64-demo");
});

test("managed identity resolve trusts an existing annotated initContainer across Registry aliases", async () => {
  const previous = managedDeployment("183.95.195.121:31438/app/cat-dog-classifier:1.0-arm64-demo", "aibox-1", "cat-dog-classifier-model-copy");
  previous.metadata.annotations["blueedge.io/model-init-container"] = "cat-dog-classifier-model-copy";
  const result = await resolveModelDeploymentWithDependencies(base, harness({ managedMatches: [previous] }).dependencies);
  assert.equal(result.action, "UPDATE");
  assert.equal(result.workload.initContainerName, "cat-dog-classifier-model-copy");
  assert.equal(result.workload.currentImage, "183.95.195.121:31438/app/cat-dog-classifier:1.0-arm64-demo");
  assert.equal(result.workload.currentVersion, "1.0-arm64-demo");
});

test("rejects Node outside EdgeUnit, NotReady Node, and incompatible architecture", async () => {
  await assert.rejects(() => publishModelDeploymentWithDependencies(base, harness({ node: node({ labels: { "blueedge.io/edge-unit": "other" } }) }).dependencies), /does not belong/);
  await assert.rejects(() => publishModelDeploymentWithDependencies(base, harness({ node: node({ ready: false }) }).dependencies), /not Ready/);
  await assert.rejects(() => publishModelDeploymentWithDependencies(base, harness({ node: node({ architecture: "arm64", labels: { "kubernetes.io/arch": "arm64" } }) }).dependencies), /not compatible/);
});

test("known framework selects its runtime profile while Kubernetes Node architecture remains the final truth", async () => {
  await assert.rejects(
    () => publishModelDeploymentWithDependencies({ ...base, predictFramework: "triton-dce-arm64" }, harness().dependencies),
    /not compatible with runtime architecture arm64/,
  );
  const accepted = await publishModelDeploymentWithDependencies({ ...base, predictFramework: "legacy-framework" }, harness().dependencies);
  assert.equal(accepted.action, "CREATE");
  await assert.rejects(() => publishModelDeploymentWithDependencies({ ...base, image: "10.244.1.2:5000/app/face:1.0" }, harness().dependencies), /不在边缘共享镜像仓库/);
  await assert.rejects(() => publishModelDeploymentWithDependencies(base, harness({ secretExists: false }).dependencies), /imagePullSecret/);
});

test("CREATE uses the selected EdgeUnit Registry host, prefix, and pull Secret", async () => {
  const h = harness({
    modelRegistry: {
      ...modelRegistry,
      registryHost: "customer-a.example.com:5443",
      repositoryPrefix: "models",
      pullSecretName: "customer-a-pull",
    },
  });
  const result = await publishModelDeploymentWithDependencies({
    ...base,
    image: "customer-a.example.com:5443/models/face:1.0-amd64",
  }, h.dependencies);
  assert.equal(result.action, "CREATE");
  assert.equal(h.calls.creates[0].spec.template.spec.initContainers[0].image, "customer-a.example.com:5443/models/face:1.0-amd64");
  assert.deepEqual(h.calls.creates[0].spec.template.spec.imagePullSecrets, [{ name: "customer-a-pull" }]);
});

test("different EdgeUnits can generate different Registry targets without a global 183 host", async () => {
  const registryA = { ...modelRegistry, registryHost: "registry-a.example.com", repositoryPrefix: "models-a", pullSecretName: "pull-a" };
  const registryB = { ...modelRegistry, registryHost: "10.20.30.50:5000", repositoryPrefix: "ai", tls: false, pullSecretName: "pull-b" };
  const a = harness({ modelRegistry: registryA });
  const b = harness({
    modelRegistry: registryB,
    node: node({ labels: { "blueedge.io/edge-unit": "edge-b" } }),
  });
  await publishModelDeploymentWithDependencies({ ...base, image: "registry-a.example.com/models-a/face:1.0-amd64" }, a.dependencies);
  await publishModelDeploymentWithDependencies({ ...base, edgeUnit: "edge-b", image: "10.20.30.50:5000/ai/face:1.0-amd64" }, b.dependencies);
  assert.equal(a.calls.creates[0].spec.template.spec.initContainers[0].image, "registry-a.example.com/models-a/face:1.0-amd64");
  assert.equal(b.calls.creates[0].spec.template.spec.initContainers[0].image, "10.20.30.50:5000/ai/face:1.0-amd64");
});

test("CREATE fails clearly when the EdgeUnit Registry is missing or disabled", async () => {
  await assert.rejects(
    () => publishModelDeploymentWithDependencies(base, harness({ registryError: new Error("EdgeUnit edge-131 model Registry is not configured") }).dependencies),
    /not configured/,
  );
  await assert.rejects(
    () => publishModelDeploymentWithDependencies(base, harness({ modelRegistry: { ...modelRegistry, enabled: false } }).dependencies),
    /disabled/,
  );
});

test("registry comparison canonicalizes the host but rejects schemes and sibling prefixes", () => {
  assert.deepEqual(parseConfiguredModelImage("REGISTRY.EXAMPLE.COM/app/face:1.0-amd64"), {
    model: "face",
    tag: "1.0-amd64",
    reference: "registry.example.com/app/face:1.0-amd64",
  });
  assert.throws(() => parseConfiguredModelImage("https://registry.example.com/app/face:1.0-amd64"), /must not include a URL scheme/);
  assert.throws(() => parseConfiguredModelImage("registry.example.com/application/face:1.0-amd64"), /不在边缘共享镜像仓库/);
});

test("rejects an unknown EdgeUnit before creating a workload", async () => {
  const h = harness({ edgeUnitExists: false });
  await assert.rejects(() => publishModelDeploymentWithDependencies(base, h.dependencies), (error) => error.status === 404);
  assert.equal(h.calls.creates.length, 0);
});

test("resolve prioritizes identity metadata, strictly resolves one legacy repository, and conflicts on ambiguity", async () => {
  await assert.rejects(() => resolveModelDeploymentWithDependencies(base, harness({ managedMatches: [managedDeployment(), managedDeployment()] }).dependencies), (error) => error.status === 409);
  const legacy = managedDeployment("registry.example.com/app/face:0.9", "legacy-node", "face-model-copy");
  legacy.metadata.labels = { "blueedge.io/edge-unit": base.edgeUnit };
  const identified = managedDeployment("registry.example.com/app/face:0.8", "identity-node", "identity-copy");
  const preferred = await resolveModelDeploymentWithDependencies(base, harness({
    managedMatches: [identified],
    edgeUnitDeployments: [legacy, structuredClone(legacy)],
  }).dependencies);
  assert.equal(preferred.matchedBy, "identity");
  assert.equal(preferred.workload.name, identified.metadata.name);
  assert.equal(preferred.workload.initContainerName, "identity-copy");
  const resolved = await resolveModelDeploymentWithDependencies(base, harness({ edgeUnitDeployments: [legacy] }).dependencies);
  assert.equal(resolved.action, "UPDATE");
  assert.equal(resolved.matchedBy, "repository");
  assert.equal(resolved.workload.initContainerName, "face-model-copy");
  assert.equal(resolved.workload.currentVersion, "0.9");
  assert.equal(resolved.workload.targetNode, "legacy-node");
  const sibling = managedDeployment("registry.example.com/app/face_embedding:0.9");
  sibling.metadata.labels = { "blueedge.io/edge-unit": base.edgeUnit };
  const create = await resolveModelDeploymentWithDependencies(base, harness({ edgeUnitDeployments: [sibling] }).dependencies);
  assert.equal(create.action, "CREATE");
  await assert.rejects(
    () => resolveModelDeploymentWithDependencies(base, harness({ edgeUnitDeployments: [legacy, structuredClone(legacy)] }).dependencies),
    (error) => error.status === 409,
  );
});

test("concurrent create is idempotent and never creates a second Deployment", async () => {
  const h = harness({ createConflict: true });
  const result = await publishModelDeploymentWithDependencies(base, h.dependencies);
  assert.equal(result.action, "CREATE");
  assert.equal(result.idempotent, true);
  assert.equal(h.calls.creates.length, 1);
  assert.equal(h.calls.updates.length, 0);
});

test("concurrent create with a different model version returns conflict instead of overwriting the winner", async () => {
  const winner = managedDeployment("registry.example.com/app/face:2.0-amd64");
  const h = harness({ createConflict: true, conflictDeployment: winner });
  await assert.rejects(
    () => publishModelDeploymentWithDependencies(base, h.dependencies),
    (error) => error.status === 409 && /another model version/.test(error.message),
  );
  assert.equal(h.calls.creates.length, 1);
  assert.equal(h.calls.updates.length, 0);
  assert.equal(winner.spec.template.spec.initContainers[0].image, "registry.example.com/app/face:2.0-amd64");
});

test("passes optimistic expectedCurrentImage failure through without a second update implementation", async () => {
  const h = harness({ managedMatches: [managedDeployment("registry.example.com/app/face:0.9")], updateError: new Error("model image changed since the page was loaded") });
  await assert.rejects(() => publishModelDeploymentWithDependencies(base, h.dependencies), /changed since/);
  assert.equal(h.calls.updates.length, 1);
});

test("status requires Deployment convergence and Pod Ready and exposes known rollout failures", () => {
  const deployment = managedDeployment();
  deployment.metadata.generation = 3;
  deployment.status = { observedGeneration: 3, replicas: 1, updatedReplicas: 1, availableReplicas: 1, unavailableReplicas: 0 };
  const readyPod = { status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] } };
  assert.equal(modelDeploymentStatus(deployment, [readyPod]).state, "READY");
  const pullFailure = { status: { phase: "Pending", initContainerStatuses: [{ name: "bams-model-copy", state: { waiting: { reason: "ImagePullBackOff" } } }] } };
  assert.deepEqual(modelDeploymentStatus(deployment, [pullFailure]), { state: "FAILED", message: "ImagePullBackOff" });
  deployment.status.conditions = [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded", message: "timed out progressing" }];
  assert.deepEqual(modelDeploymentStatus(deployment, []), {
    state: "FAILED",
    message: "ProgressDeadlineExceeded: timed out progressing",
  });
  deployment.metadata.generation = 4;
  assert.equal(modelDeploymentStatus(deployment, []).state, "CREATING");
  const terminatingFailure = {
    metadata: { deletionTimestamp: "2026-08-17T00:00:00Z" },
    status: { phase: "Pending", initContainerStatuses: [{ name: "bams-model-copy", state: { waiting: { reason: "ImagePullBackOff" } } }] },
  };
  assert.equal(modelDeploymentStatus(deployment, [terminatingFailure]).state, "CREATING");
});
