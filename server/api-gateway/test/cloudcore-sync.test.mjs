import test from "node:test";
import assert from "node:assert/strict";
import { buildIncrementalSyncStatus } from "../dist/services/cloudcore-sync.service.js";

function configMap(yaml) {
  return { data: { "cloudcore.yaml": yaml } };
}

test("reports KubeEdge incremental sync when CloudHub, EdgeController and SyncController are enabled", () => {
  const status = buildIncrementalSyncStatus(configMap(`
modules:
  cloudHub:
    enable: true
  edgeController:
    enable: true
  syncController:
    enable: true
`));

  assert.equal(status.installed, true);
  assert.equal(status.enabled, true);
  assert.equal(status.taskManager, false);
});

test("reports incremental sync disabled when SyncController is explicitly disabled", () => {
  const status = buildIncrementalSyncStatus(configMap(`
modules:
  cloudHub:
    enable: true
  edgeController:
    enable: true
  syncController:
    enable: false
`));

  assert.equal(status.enabled, false);
  assert.equal(status.syncController, false);
});

test("accepts generated CloudCore configuration defaults when module switches are omitted", () => {
  const status = buildIncrementalSyncStatus(configMap("modules: {}\n"));
  assert.equal(status.enabled, true);
});
