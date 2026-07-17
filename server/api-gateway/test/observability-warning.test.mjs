import test from "node:test";
import assert from "node:assert/strict";
import { nodeMetricsUnavailableWarning, podMetricsUnavailableWarning } from "../dist/services/observability.service.js";

test("does not expose a raw Kubernetes error when edge-node metrics are unavailable", () => {
  const result = nodeMetricsUnavailableWarning("k8s-laptop-edge");
  assert.deepEqual(result, {
    source: "metrics.node",
    code: "metrics_unavailable",
    message: "节点 k8s-laptop-edge 的 CPU、内存监控指标暂不可用，不影响节点健康状态和其他操作",
  });
  assert.doesNotMatch(result.message, /metrics\.k8s\.io|Kubernetes request|404/);
});

test("does not expose a raw Kubernetes error when pod metrics are unavailable", () => {
  const result = podMetricsUnavailableWarning("npu-mapper-blueedge-import-69c95dcf98-8gnxf");
  assert.deepEqual(result, {
    source: "metrics.pod",
    code: "metrics_unavailable",
    message: "Pod npu-mapper-blueedge-import-69c95dcf98-8gnxf 尚未运行或指标尚未采集，暂无监控数据",
  });
  assert.doesNotMatch(result.message, /metrics\.k8s\.io|Kubernetes request|404/);
});
