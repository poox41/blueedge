import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceConfig } from "../dist/services/device-config.service.js";
import { parseYamlObject, validateDeviceConfigInput } from "../dist/utils/device-config.js";

const model = {
  spec: {
    properties: [{ name: "temperature", type: "DOUBLE" }],
  },
};

const input = {
  name: "e2e-temperature-device",
  namespace: "kubeedge",
  deviceModelRef: "e2e-temperature-model",
  nodeName: "k8s-laptop-edge",
  protocol: "ModbusTCP",
  labels: {},
  accessConfigYaml: "protocol: ModbusTCP\nhost: 192.168.1.100\nport: 502\nslaveId: 1\ntimeout: 3000",
  properties: [{
    propertyName: "temperature",
    desiredValue: "25",
    collectIntervalSeconds: 10,
    reportIntervalSeconds: 60,
    accessConfigYaml: "collect:\n  register: HoldingRegister\n  address: 0\n  quantity: 1\n  slaveId: 1\nreport:\n  topic: device/temperature\n  qos: 0",
  }],
};

test("parses valid access and twin YAML", () => {
  const result = validateDeviceConfigInput(input, model);
  assert.equal(result.accessConfig.protocol, "ModbusTCP");
  assert.equal(result.parsedTwinConfigs.temperature.collect.register, "HoldingRegister");
});

test("rejects malformed YAML and HTML highlighting", () => {
  assert.throws(() => parseYamlObject("protocol: [", "访问配置 YAML"), /解析失败/);
  assert.throws(() => parseYamlObject('protocol: <span style="color:#9CDCFE">MQTT</span>', "访问配置 YAML"), /HTML/);
});

test("rejects protocol mismatch, unknown and duplicate twins", () => {
  assert.throws(() => validateDeviceConfigInput({ ...input, protocol: "MQTT" }, model), /访问协议不一致/);
  assert.throws(() => validateDeviceConfigInput({ ...input, properties: [{ ...input.properties[0], propertyName: "humidity" }] }, model), /不属于设备模型/);
  assert.throws(() => validateDeviceConfigInput({ ...input, properties: [input.properties[0], input.properties[0]] }, model), /不能重复/);
});

test("rolls Device back when ConfigMap creation fails", async () => {
  const calls = [];
  const client = {
    async get(path) {
      if (path.includes("devicemodels")) return model;
      return {};
    },
    async request(path, options = {}) {
      calls.push({ path, method: options.method });
      if (path.endsWith("/devices") && options.method === "POST") return { metadata: { uid: "device-uid" } };
      if (path.endsWith("/configmaps") && options.method === "POST") throw new Error("forced configmap failure");
      return {};
    },
  };
  await assert.rejects(() => createDeviceConfig(input, client), /Device 已回滚/);
  assert.deepEqual(calls.map((item) => item.method), ["POST", "POST", "DELETE"]);
});

test("does not create ConfigMap when Device creation fails", async () => {
  const calls = [];
  const client = {
    async get(path) {
      if (path.includes("devicemodels")) return model;
      return {};
    },
    async request(path, options = {}) {
      calls.push({ path, method: options.method });
      throw new Error("forced device failure");
    },
  };
  await assert.rejects(() => createDeviceConfig(input, client), /forced device failure/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /\/devices$/);
});
