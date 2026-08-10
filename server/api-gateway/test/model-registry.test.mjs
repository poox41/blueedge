import assert from "node:assert/strict";
import test from "node:test";
import {
  modelRepositoriesFromCatalog,
  updateDeploymentModelImage,
} from "../dist/services/model-registry.service.js";

function deployment() {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "face-server", namespace: "default", resourceVersion: "12" },
    spec: {
      template: {
        metadata: {},
        spec: {
          initContainers: [
            { name: "init-config", image: "busybox:1.36" },
            { name: "face-model-copy", image: "registry.example.com/app/face:1.3-amd64-test" },
            { name: "embedding-model-copy", image: "registry.example.com/app/face_embedding:1.0-amd64" },
          ],
          containers: [{ name: "server", image: "tritonserver:latest" }],
        },
      },
    },
  };
}

test("catalog exposes only repositories under the configured model prefix", () => {
  assert.deepEqual(modelRepositoriesFromCatalog([
    "blueedge/frontend",
    "app/face_embedding",
    "app/face",
    "app",
    null,
  ], "app"), [
    { name: "face", repository: "app/face" },
    { name: "face_embedding", repository: "app/face_embedding" },
  ]);
});

test("updates only the selected model initContainer and preserves the deployment", () => {
  const original = deployment();
  const result = updateDeploymentModelImage(original, {
    containerName: "embedding-model-copy",
    model: "face_embedding",
    tag: "1.1-amd64",
    expectedCurrentImage: "registry.example.com/app/face_embedding:1.0-amd64",
  }, "registry.example.com/app/face_embedding:1.1-amd64", "registry.example.com/app/");

  assert.equal(original.spec.template.spec.initContainers[2].image, "registry.example.com/app/face_embedding:1.0-amd64");
  assert.equal(result.previousImage, "registry.example.com/app/face_embedding:1.0-amd64");
  assert.equal(result.deployment.spec.template.spec.initContainers[1].image, "registry.example.com/app/face:1.3-amd64-test");
  assert.equal(result.deployment.spec.template.spec.initContainers[2].image, "registry.example.com/app/face_embedding:1.1-amd64");
  assert.equal(result.deployment.metadata.resourceVersion, "12");
  assert.equal(result.deployment.spec.template.metadata.annotations["blueedge.io/model-image-container"], "embedding-model-copy");
});

test("rejects stale updates and non-model initContainers", () => {
  assert.throws(() => updateDeploymentModelImage(deployment(), {
    containerName: "face-model-copy",
    model: "face",
    tag: "1.4-amd64",
    expectedCurrentImage: "registry.example.com/app/face:1.2-amd64",
  }, "registry.example.com/app/face:1.4-amd64", "registry.example.com/app/"), /changed since/);

  assert.throws(() => updateDeploymentModelImage(deployment(), {
    containerName: "init-config",
    model: "face",
    tag: "1.4-amd64",
  }, "registry.example.com/app/face:1.4-amd64", "registry.example.com/app/"), /not a configured model container/);
});
