import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  getEdgeUnitModelRegistryWithDependencies,
  modelRegistryData,
  modelRegistryFromData,
  normalizeEdgeUnitModelRegistry,
  normalizeRegistryHost,
  normalizeRepositoryPrefix,
  putEdgeUnitModelRegistryWithDependencies,
  readEdgeUnitRegistryCaWithDependencies,
} from "../dist/services/edge-unit-model-registry.service.js";

const registryCa = fs.readFileSync(new URL("./fixtures/registry-ca-cert.pem", import.meta.url), "utf8");

function edgeUnit(name, data = {}) {
  return {
    metadata: { name: `edgeunit-${name}`, resourceVersion: "1" },
    data: { name, ...data },
  };
}

function dependencies(items, secrets = {}) {
  return {
    async listEdgeUnits() { return items; },
    async updateEdgeUnit(_name, resource) { return resource; },
    async getSecret(_namespace, name) {
      if (!secrets[name]) throw new Error("404 not found");
      return secrets[name];
    },
  };
}

test("normalizes Registry hosts and repository prefixes for Kubernetes image references", () => {
  assert.equal(normalizeRegistryHost("https://183.95.195.121:31438/"), "183.95.195.121:31438");
  assert.equal(normalizeRegistryHost("183.95.195.121:31438/"), "183.95.195.121:31438");
  for (const input of ["app", "/app", "app/", "/app/"]) assert.equal(normalizeRepositoryPrefix(input), "app");
  assert.throws(() => normalizeRegistryHost("https://registry.example.com/path"), /only a registry hostname/);
  assert.throws(() => normalizeRepositoryPrefix("app//models"), /invalid/);
});

test("EdgeUnit A and B persist independent model Registry configuration", () => {
  const a = normalizeEdgeUnitModelRegistry({
    enabled: true,
    registryHost: "registry-a.example.com",
    repositoryPrefix: "/models-a/",
    tls: true,
    pullSecretName: "pull-a",
    readCredentialRef: "registry-a-credential",
    caSecretRef: "registry-a-ca",
  });
  const b = normalizeEdgeUnitModelRegistry({
    enabled: true,
    registryHost: "10.20.30.50:5000",
    repositoryPrefix: "ai",
    tls: false,
    pullSecretName: "pull-b",
    readCredentialRef: "registry-b-credential",
    caSecretRef: "",
  });
  assert.deepEqual(modelRegistryFromData(modelRegistryData(a)), a);
  assert.deepEqual(modelRegistryFromData(modelRegistryData(b)), b);
  assert.notEqual(a.registryHost, b.registryHost);
  assert.notEqual(a.pullSecretName, b.pullSecretName);
});

test("GET reports credential state without leaking Secret material or readCredentialRef", async () => {
  const config = normalizeEdgeUnitModelRegistry({
    enabled: true,
    registryHost: "registry.example.com",
    repositoryPrefix: "app",
    tls: true,
    pullSecretName: "registry-pull",
    readCredentialRef: "registry-api-credential",
    caSecretRef: "",
  });
  const secret = {
    data: {
      username: Buffer.from("registry-user").toString("base64"),
      password: Buffer.from("registry-password").toString("base64"),
    },
  };
  const result = await getEdgeUnitModelRegistryWithDependencies(
    "edge-a",
    dependencies([edgeUnit("edge-a", modelRegistryData(config))], { "registry-api-credential": secret }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.credentialConfigured, true);
  const response = JSON.stringify(result.body);
  assert.equal(response.includes("registry-user"), false);
  assert.equal(response.includes("registry-password"), false);
  assert.equal(response.includes("registry-api-credential"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.body, "readCredentialRef"), false);
});

test("PUT rejects inline credentials and stores only a credential reference", async () => {
  const unit = edgeUnit("edge-a");
  const deps = dependencies([unit]);
  const invalid = await putEdgeUnitModelRegistryWithDependencies("edge-a", {
    enabled: true,
    registryHost: "registry.example.com",
    repositoryPrefix: "app",
    tls: true,
    pullSecretName: "registry-pull",
    readCredentialRef: "registry-api-credential",
    caSecretRef: "",
    password: "must-not-be-accepted",
  }, deps);
  assert.equal(invalid.status, 400);

  const valid = await putEdgeUnitModelRegistryWithDependencies("edge-a", {
    enabled: true,
    registryHost: "https://registry.example.com/",
    repositoryPrefix: "/app/",
    tls: true,
    pullSecretName: "registry-pull",
    readCredentialRef: "registry-api-credential",
    caSecretRef: "",
  }, deps);
  assert.equal(valid.status, 200);
  assert.equal(unit.data.modelRegistryHost, undefined);
  assert.equal(valid.body.registryHost, "registry.example.com");
  assert.equal(Object.prototype.hasOwnProperty.call(valid.body, "readCredentialRef"), false);
});

test("reads the new readCredentialRef first and falls back to legacy persisted credentialRef", () => {
  const common = {
    modelRegistryEnabled: "true",
    modelRegistryHost: "registry.example.com",
    modelRegistryRepositoryPrefix: "app",
    modelRegistryTls: "true",
    modelRegistryPullSecretName: "registry-pull",
  };
  assert.equal(modelRegistryFromData({
    ...common,
    modelRegistryReadCredentialRef: "new-reader",
    modelRegistryCredentialRef: "legacy-reader",
  }).readCredentialRef, "new-reader");
  assert.equal(modelRegistryFromData({
    ...common,
    modelRegistryCredentialRef: "legacy-reader",
  }).readCredentialRef, "legacy-reader");
});

test("legacy persisted credentialRef still configures the BlueEdge Registry reader", async () => {
  const legacyData = {
    modelRegistryEnabled: "true",
    modelRegistryHost: "registry.example.com",
    modelRegistryRepositoryPrefix: "app",
    modelRegistryTls: "true",
    modelRegistryPullSecretName: "registry-pull",
    modelRegistryCredentialRef: "legacy-reader",
  };
  const secret = {
    data: {
      username: Buffer.from("reader").toString("base64"),
      password: Buffer.from("password").toString("base64"),
    },
  };
  const result = await getEdgeUnitModelRegistryWithDependencies(
    "edge-a",
    dependencies([edgeUnit("edge-a", legacyData)], { "legacy-reader": secret }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.credentialConfigured, true);
});

test("new PUT writes readCredentialRef and removes the legacy persisted key", async () => {
  const stored = [];
  const unit = edgeUnit("edge-a", { modelRegistryCredentialRef: "legacy-reader" });
  const deps = {
    ...dependencies([unit]),
    async updateEdgeUnit(_name, resource) { stored.push(resource); return resource; },
  };
  const result = await putEdgeUnitModelRegistryWithDependencies("edge-a", {
    enabled: true,
    registryHost: "registry.example.com",
    repositoryPrefix: "app",
    tls: true,
    pullSecretName: "registry-pull",
    readCredentialRef: "new-reader",
    caSecretRef: "",
  }, deps);
  assert.equal(result.status, 200);
  assert.equal(stored[0].data.modelRegistryReadCredentialRef, "new-reader");
  assert.equal(Object.prototype.hasOwnProperty.call(stored[0].data, "modelRegistryCredentialRef"), false);
});

test("CA configuration is optional for system trust and rejects missing or invalid CA Secrets clearly", async () => {
  const publicCaConfig = normalizeEdgeUnitModelRegistry({
    enabled: true,
    registryHost: "registry.example.com",
    repositoryPrefix: "app",
    tls: true,
    pullSecretName: "registry-pull",
    readCredentialRef: "",
    caSecretRef: "",
  });
  assert.equal(await readEdgeUnitRegistryCaWithDependencies(publicCaConfig, dependencies([])), null);

  const customCaConfig = { ...publicCaConfig, caSecretRef: "registry-ca" };
  assert.deepEqual(
    await readEdgeUnitRegistryCaWithDependencies(customCaConfig, dependencies([], {
      "registry-ca": { data: { "ca.crt": Buffer.from(registryCa).toString("base64") } },
    })),
    { pem: registryCa.trim() },
  );
  await assert.rejects(
    () => readEdgeUnitRegistryCaWithDependencies(customCaConfig, dependencies([])),
    /Registry CA Secret registry-ca is missing/,
  );
  await assert.rejects(
    () => readEdgeUnitRegistryCaWithDependencies(customCaConfig, dependencies([], {
      "registry-ca": { data: { "ca.crt": Buffer.from("not a certificate").toString("base64") } },
    })),
    /valid ca.crt certificate/,
  );

  const putBody = {
    ...customCaConfig,
    readCredentialRef: "",
  };
  const missingPut = await putEdgeUnitModelRegistryWithDependencies(
    "edge-a",
    putBody,
    dependencies([edgeUnit("edge-a")]),
  );
  assert.equal(missingPut.status, 400);
  assert.match(missingPut.body.message, /Registry CA Secret registry-ca is missing/);
  const invalidPut = await putEdgeUnitModelRegistryWithDependencies(
    "edge-a",
    putBody,
    dependencies([edgeUnit("edge-a")], {
      "registry-ca": { data: { "ca.crt": Buffer.from("not a certificate").toString("base64") } },
    }),
  );
  assert.equal(invalidPut.status, 400);
  assert.match(invalidPut.body.message, /valid ca.crt certificate/);
});
