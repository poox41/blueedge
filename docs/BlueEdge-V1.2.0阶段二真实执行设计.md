# BlueEdge V1.2.0 阶段二真实执行设计

## 1. BatchTask 状态机

状态：`Draft → Planned → Queued → Running → Succeeded/PartiallySucceeded/Failed`，取消路径为 `Queued/Running → Cancelling → Cancelled`。

- 创建且 schema 校验成功进入 `Planned`。
- 执行请求写入唯一 `executionId`，通过 ConfigMap `resourceVersion` 或后续 CRD status 乐观锁保证幂等。
- 调度器领取任务后进入 `Queued`，实际资源 apply 前进入 `Running`。
- 每个目标保存独立结果；部分目标失败进入 `PartiallySucceeded`。
- 重试只重试失败目标，并记录 attempt、错误、开始和结束时间。
- 取消先停止创建新资源，再处理已创建资源，最终进入 `Cancelled`。
- 超时进入 `Failed` 或按已成功目标进入 `PartiallySucceeded`。

## 2. BatchWorkload 执行器

```text
BatchWorkload Plan
→ 校验 NodeGroup 和 namespace
→ 渲染 Deployment / EdgeApplication
→ Server-Side Apply
→ 记录生成资源 UID
→ 观察 Deployment、Pod 和 Event
→ 更新目标结果和 BatchTask 状态
```

- 使用稳定 field manager，按 `taskId + targetGroup` 生成幂等资源名。
- dry-run 校验通过后才 apply。
- 目标 NodeGroup 通过 nodeSelector/affinity 映射，不能直接信任前端标签。
- 取消和清理只处理带该 `taskId` owner label 的资源。

## 3. 镜像预热执行器

第一版建议使用短生命周期 DaemonSet：

- 每个目标节点通过 node affinity 精确调度。
- initContainer 或主容器执行目标镜像拉取和校验。
- 通过 Pod 状态、容器退出码和 Events 汇总节点结果。
- 离线节点保持 pending，超过 timeout 标记失败。
- 设置并发批次、退避重试和自动清理 TTL。
- 后续如 KubeEdge Operation CRD 成熟，再迁移到专用控制器。

## 4. 节点升级执行器

节点升级属于高风险能力，V1.2.0 仅保留计划，不直接实现。

- 升级前检查 KubeEdge/Kubernetes 版本矩阵、磁盘、网络、运行时和节点 Ready。
- 支持 canary、分批并发上限和维护窗口。
- 每个节点保存旧版本、配置备份和回滚命令。
- 节点离线不强制升级，等待恢复或超时失败。
- 升级后检查 EdgeCore 进程、Node Ready、DeviceTwin 和工作负载健康。
- 回滚失败时立即停止后续批次并进入人工介入状态。
