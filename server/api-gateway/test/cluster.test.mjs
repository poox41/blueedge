import assert from "node:assert/strict";
import test from "node:test";
import { parseKubeadmClusterConfiguration } from "../dist/services/cluster.service.js";

test("reads the real cluster name from kubeadm configuration", () => {
  const result = parseKubeadmClusterConfiguration("clusterName: kubernetes\nkubernetesVersion: v1.28.15\n");
  assert.deepEqual(result, { name: "kubernetes", kubernetesVersion: "v1.28.15" });
});

test("does not invent a cluster name when kubeadm configuration is incomplete", () => {
  assert.throws(() => parseKubeadmClusterConfiguration("kubernetesVersion: v1.28.15\n"), /clusterName/);
});
