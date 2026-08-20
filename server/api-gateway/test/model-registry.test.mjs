import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import test from "node:test";
import {
  edgeUnitRegistryConnection,
  listModelTags,
  modelRepositoriesFromCatalog,
  registryTlsOptions,
  updateDeploymentModelImage,
} from "../dist/services/model-registry.service.js";

const registryCert = fs.readFileSync(new URL("./fixtures/registry-ca-cert.pem", import.meta.url), "utf8");
const registryKey = fs.readFileSync(new URL("./fixtures/registry-ca-key.pem", import.meta.url), "utf8");

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

test("HTTPS Registry uses system trust when caSecretRef is absent", () => {
  const connection = edgeUnitRegistryConnection({
    enabled: true,
    registryHost: "registry.example.com",
    repositoryPrefix: "app",
    tls: true,
    pullSecretName: "registry-pull",
    readCredentialRef: "",
    caSecretRef: "",
  });
  assert.deepEqual(registryTlsOptions(connection), { rejectUnauthorized: true });
});

test("self-signed HTTPS Registry succeeds only when the configured CA is supplied", async () => {
  const server = https.createServer({ key: registryKey, cert: registryCert }, (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v2/app/face/tags/list") {
      res.end(JSON.stringify({ name: "app/face", tags: ["1.3-amd64-test"] }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ errors: [{ code: "NAME_UNKNOWN" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const registry = {
      enabled: true,
      registryHost: `127.0.0.1:${address.port}`,
      repositoryPrefix: "app",
      tls: true,
      pullSecretName: "registry-pull",
      readCredentialRef: "",
      caSecretRef: "registry-ca",
    };
    await assert.rejects(() => listModelTags("face", edgeUnitRegistryConnection(registry)), /self-signed certificate/);
    const result = await listModelTags("face", edgeUnitRegistryConnection(registry, null, registryCert));
    assert.deepEqual(result, { model: "face", repository: "app/face", items: ["1.3-amd64-test"] });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
