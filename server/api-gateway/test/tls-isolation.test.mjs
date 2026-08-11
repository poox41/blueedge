import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { k8sTlsOptions } from "../dist/clients/k8s-client.js";
import { config } from "../dist/config.js";

test("K8S_SKIP_TLS_VERIFY is scoped to the Kubernetes request options", () => {
  const originalSkip = config.k8sSkipTlsVerify;
  const originalCaFile = config.k8sCaFile;
  const originalGlobalSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    config.k8sCaFile = "";
    config.k8sSkipTlsVerify = true;
    assert.equal(k8sTlsOptions(new URL("https://kubernetes.example.test")).rejectUnauthorized, false);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalGlobalSetting);

    config.k8sSkipTlsVerify = false;
    assert.equal(k8sTlsOptions(new URL("https://kubernetes.example.test")).rejectUnauthorized, true);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalGlobalSetting);
  } finally {
    config.k8sSkipTlsVerify = originalSkip;
    config.k8sCaFile = originalCaFile;
  }
});

test("non-Kubernetes HTTP targets do not receive TLS overrides", () => {
  assert.deepEqual(k8sTlsOptions(new URL("http://127.0.0.1:8080")), {});
});

test("gateway refuses an externally injected global TLS bypass", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "import('./dist/config.js')"],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed/);
});
