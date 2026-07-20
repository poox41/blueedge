import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccessConfigData,
  buildJoinCommand,
} from "../dist/services/access-config.service.js";

const payload = {
  name: "edge-01",
  nodeName: "edge-01",
  edgeUnitRef: "unit-a",
  architecture: "amd64",
  os: "linux",
  kubeEdgeVersion: "v1.21.0",
  cloudCoreAddress: "10.0.0.1:10000",
  labels: { region: "east" },
};

test("AccessConfig does not inherit or retain an EdgeUnit NodeGroup", () => {
  const data = buildAccessConfigData(payload, { nodeGroupRef: "legacy-group" });

  assert.equal(data.edgeUnitRef, "unit-a");
  assert.equal(data.nodeGroupRef, "");
  assert.deepEqual(JSON.parse(data.labelsJson), {
    region: "east",
    "blueedge.io/managed-by": "blueedge",
    "blueedge.io/node-role": "edge",
  });
});

test("KubeEdge join command registers BlueEdge product and ownership labels", () => {
  const command = buildJoinCommand({
    ...payload,
    protocol: "https",
    driver: "systemd",
    criAddress: "/run/containerd/containerd.sock",
    registry: "",
  }, "join-token");

  assert.match(command, /--labels=blueedge\.io\/managed-by=blueedge,blueedge\.io\/node-role=edge,blueedge\.io\/edge-unit=unit-a/);
  assert.match(command, /--edgenode-name=edge-01/);
});
