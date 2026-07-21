import assert from "node:assert/strict";
import test from "node:test";
import { buildDeviceModelSummaryView, normalizeDeviceStatus } from "../dist/services/device.service.js";

test("device model detail includes matching device instance items", () => {
  const model = {
    metadata: { name: "temperature-model", namespace: "kubeedge" },
  };
  const devices = [
    {
      metadata: {
        name: "temperature-device",
        namespace: "kubeedge",
        annotations: { "blueedge.io/description": "车间温度传感器" },
      },
      spec: { deviceModelRef: { name: "temperature-model" }, nodeName: "edge-node-1" },
      status: { state: "online" },
    },
    {
      metadata: { name: "other-device", namespace: "kubeedge" },
      spec: { deviceModelRef: { name: "other-model" }, nodeName: "edge-node-2" },
    },
  ];

  const summary = buildDeviceModelSummaryView(model, devices, { includeDeviceItems: true });

  assert.equal(summary.devices.total, 1);
  assert.deepEqual(summary.devices.items, [{
    name: "temperature-device",
    namespace: "kubeedge",
    nodeName: "edge-node-1",
    description: "车间温度传感器",
    status: "online",
    lastReportedAt: "",
  }]);
});

test("device summary exposes the latest reported timestamp without returning twin items", async () => {
  const { summarizeTwins } = await import("../dist/services/device.service.js");
  const summary = summarizeTwins([
    { status: "synced", lastUpdatedAt: "2026-07-20T10:00:00Z" },
    { status: "unknown", lastUpdatedAt: "2026-07-21T09:22:01Z" },
  ], false);

  assert.equal(summary.lastReportedAt, "2026-07-21T09:22:01Z");
  assert.deepEqual(summary.items, []);
});

test("device model list summary keeps the lightweight device aggregate", () => {
  const model = { metadata: { name: "temperature-model", namespace: "kubeedge" } };
  const summary = buildDeviceModelSummaryView(model, [], {});

  assert.equal(summary.devices.total, 0);
  assert.equal("items" in summary.devices, false);
});

test("device status is binary and defaults to offline before an online report", () => {
  assert.equal(normalizeDeviceStatus({ status: { state: "online" } }), "online");
  assert.equal(normalizeDeviceStatus({ status: { connectionStatus: "disconnected" } }), "offline");
  assert.equal(normalizeDeviceStatus({ metadata: { name: "not-reported-yet" } }), "offline");
});
