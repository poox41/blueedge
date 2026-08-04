import test from "node:test";
import assert from "node:assert/strict";
import { buildCloudCoreValues } from "../dist/services/cloudcore-installer.service.js";

const base = {
  version: "v1.22.1",
  accessAddresses: ["10.12.1.4"],
  protocols: ["WebSocket", "QUIC"],
  mqttEnabled: true,
  ports: { websocket: "30000", quic: "30001", https: "30002", cloudStream: "30003", tunnel: "30004" },
};

test("builds official CloudCore Helm values from a dedicated EdgeUnit", () => {
  const values = buildCloudCoreValues(base);
  assert.deepEqual(values.cloudCore.modules.cloudHub.advertiseAddress, ["10.12.1.4"]);
  assert.equal(values.cloudCore.modules.cloudHub.websocket.enable, true);
  assert.equal(values.cloudCore.modules.cloudHub.quic.enable, true);
  assert.equal(values.cloudCore.modules.taskManager.enable, true);
  assert.equal(values.cloudCore.service.cloudhubNodePort, "30000");
  assert.equal(values.cloudCore.image.tag, "v1.22.1");
  assert.equal(values.cloudCore.hostNetWork, false);
  assert.equal(values.controllerManager.enable, true);
  assert.equal(values.mosquitto.enable, true);
});

test("rejects a dedicated install without an externally reachable CloudCore address", () => {
  assert.throws(() => buildCloudCoreValues({ ...base, accessAddresses: [""] }), /至少需要一个/);
});

test("rejects NodePorts outside the Kubernetes NodePort range", () => {
  assert.throws(() => buildCloudCoreValues({ ...base, ports: { ...base.ports, websocket: "10000" } }), /30000-32767/);
});

test("rejects unsupported KubeEdge versions", () => {
  assert.throws(() => buildCloudCoreValues({ ...base, version: "v1.18.0" }), /不支持/);
});
