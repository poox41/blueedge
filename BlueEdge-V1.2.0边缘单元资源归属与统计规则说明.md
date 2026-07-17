# BlueEdge V1.2.0 边缘单元资源归属与统计规则说明

> 文档日期：2026-07-17
> 文档状态：已按当前实现核对
> 适用范围：EdgeUnit、NodeGroup、Node、Deployment、EdgeApplication 的绑定、展示与统计

## 1. 文档目的

本文用于明确 BlueEdge V1.2.0 中以下对象之间的关系，并记录本次资源归属污染问题的原因、修复原则、当前实现和验收标准：

- Kubernetes 集群（Cluster）
- 边缘单元（EdgeUnit）
- 边缘节点组（NodeGroup）
- 边缘节点（Node）
- 工作负载（Deployment）
- 应用实例（当前卡片统计口径实际对应 EdgeApplication 资源）
- 命名空间（Namespace）

本文也是后续开发、测试和线上排查的统一口径，避免再次仅通过 `clusterName` 判断资源归属。

## 2. 问题背景

创建边缘单元 `demo-edge-unit` 时，其配置为：

```yaml
clusterName: kubernetes
nodeGroupRef: ""
```

该 EdgeUnit 已选择 Kubernetes 集群，但没有绑定 NodeGroup。旧逻辑却根据 `clusterName=kubernetes` 读取并统计整个集群的 Deployment、Pod 或应用资源，导致页面曾出现类似结果：

```text
边缘节点：0/0
工作负载：20/20
应用实例：0/1
```

这不符合产品资源模型。没有 NodeGroup 的 EdgeUnit 没有明确的节点管理范围，因此不能拥有该集群中的工作负载和应用资源。

## 3. 正确的资源模型

```text
Kubernetes Cluster
│
├── EdgeUnit A
│   └── nodeGroupRef: NodeGroup A
│       ├── Node A1
│       └── Node A2
│
├── EdgeUnit B
│   └── nodeGroupRef: NodeGroup B
│       └── Node B1
│
└── EdgeUnit C
    └── nodeGroupRef: 空
        └── 不拥有节点、工作负载或边缘应用
```

核心关系为：

```text
EdgeUnit
    │ nodeGroupRef
    ▼
NodeGroup
    │ spec.nodes 或节点标签选择器
    ▼
Node
    ▲
    │ nodeAffinity / nodeSelector / Pod.spec.nodeName
Deployment ──生成──> Pod

EdgeApplication
    │ spec.workloadScope.targetNodeGroups
    ▼
NodeGroup
```

## 4. 各对象的定位

| 对象 | 定位 | 与 EdgeUnit 的关系 |
| --- | --- | --- |
| Cluster | Kubernetes 基础设施和 API 访问边界 | `clusterName` 只决定去哪个集群读取资源，不决定资源属于哪个 EdgeUnit |
| EdgeUnit | BlueEdge 产品层面的边缘管理单元 | 通过 `nodeGroupRef` 建立实际资源管理范围 |
| NodeGroup | EdgeUnit 管理的边缘节点集合 | 通过显式节点列表或标签选择器确定节点 |
| Node | 真实 Kubernetes 节点 | 被 NodeGroup 纳管，是 Pod 的实际运行位置 |
| Deployment | 当前“工作负载”统计的主要对象 | 必须明确绑定 EdgeUnit/NodeGroup，或已有 Pod 实际运行在该 NodeGroup 节点上 |
| Pod | Deployment 产生的运行副本 | 用于判断工作负载是否真实运行在 NodeGroup 节点以及是否健康 |
| EdgeApplication | BlueEdge/KubeEdge 边缘应用资源 | 通过 EdgeUnit 标签或 `targetNodeGroups` 归属于 EdgeUnit |
| Namespace | Kubernetes 集群内的逻辑隔离维度 | 是资源查询和筛选条件，不是 EdgeUnit 的资源归属边界 |

当前网关在其已连接的目标 Kubernetes 集群内按名称读取 NodeGroup，EdgeApplication 和 Deployment/Pod 则带 Namespace。本文所有归属判断均以同一网关目标集群为前提；`clusterName` 本身不会替代真实的多集群连接路由或凭据隔离。

## 5. 资源归属规则

### 5.1 Cluster 只负责定位集群

错误关系：

```text
EdgeUnit
    └── clusterName
        └── 集群中的全部 Deployment / Pod / EdgeApplication
```

正确关系：

```text
EdgeUnit
    └── nodeGroupRef
        └── NodeGroup
            └── Node
                └── 绑定或实际运行在这些节点上的资源
```

`clusterName` 不能作为工作负载、应用或节点的最终归属依据。同一个 Cluster 可以同时承载多个 EdgeUnit，资源必须继续按照 NodeGroup 边界隔离。

### 5.2 EdgeUnit 必须通过 NodeGroup 获得资源范围

EdgeUnit ConfigMap 中的关键字段：

```yaml
clusterName: kubernetes
nodeGroupRef: laptop-edge-group
```

含义为：

```text
demo-edge-unit
    └── laptop-edge-group
        └── k8s-laptop-edge
```

如果 `nodeGroupRef` 为空，或者引用的 NodeGroup 不存在，则不能回退统计整个集群。

### 5.3 NodeGroup 决定节点归属

NodeGroup 可以通过显式节点列表管理节点：

```yaml
spec:
  nodes:
    - k8s-laptop-edge
```

也可以通过标签选择器匹配节点。NodeGroup 最终解析出的 Node 集合就是 EdgeUnit 的实际边缘节点范围。需要注意：当前卡片的“节点总数”在 NodeGroup 配置了 `spec.nodes` 时采用配置项数量，因此配置了不存在或已删除的节点时，仍会进入总数，但不会进入 Ready 数。

### 5.4 Deployment 的归属

新建或更新普通工作负载时，后端自动写入：

```yaml
metadata:
  labels:
    blueedge.io/edge-unit: demo-edge-unit
    blueedge.io/node-group: laptop-edge-group
spec:
  template:
    metadata:
      labels:
        blueedge.io/edge-unit: demo-edge-unit
        blueedge.io/node-group: laptop-edge-group
```

同时根据 NodeGroup 类型写入调度约束：

- NodeGroup 使用显式节点列表时，写入基于 `kubernetes.io/hostname` 的必选 NodeAffinity。
- NodeGroup 使用标签选择器时，将选择条件合并到 `nodeSelector`。
- 如果请求指定的 `nodeName` 不属于 NodeGroup，后端拒绝创建。
- 如果原有 `nodeSelector` 与 NodeGroup 选择器冲突，后端拒绝创建。

当前实现从 Deployment 及其 Pod 模板的 label/annotation 中读取以下兼容字段，只要其中任意值等于 EdgeUnit 名称或其 `nodeGroupRef`，就视为显式归属：

- `blueedge.io/edge-unit`
- `blueedge.io/node-group`
- `blueedge.io/nodegroup`
- `kubeedge.io/nodegroup`
- `edgeUnit`
- `nodeGroup`

为了兼容历史数据，当前统计还会识别已经有 Pod 实际运行在 NodeGroup 节点上的 Deployment。但不会因为 Deployment 与 EdgeUnit 位于同一 Cluster 就将其纳入统计。

历史运行位置识别不是通过 Pod → ReplicaSet → Deployment 的 OwnerReference 链回溯，而是使用 Deployment selector 匹配同 Namespace Pod，并检查 Pod 的 `spec.nodeName` 是否属于 NodeGroup。没有 selector 的 Deployment 不通过该方式反推归属，裸 Pod 也不计入 Deployment 总数。

### 5.5 EdgeApplication 的归属

EdgeApplication 应通过以下任一有效方式明确目标：

```yaml
metadata:
  labels:
    blueedge.io/edge-unit: demo-edge-unit
```

或者：

```yaml
spec:
  workloadScope:
    targetNodeGroups:
      - laptop-edge-group
```

EdgeApplication 只有明确指向当前 EdgeUnit 或其 NodeGroup 时，才计入该 EdgeUnit 的应用统计。当前实现采用“任一声明匹配即可”的兼容策略；如果 EdgeUnit 标签与 `targetNodeGroups` 指向不同管理单元，资源可能被多个 EdgeUnit 同时识别，属于需要避免的脏数据场景。

## 6. 页面统计口径

### 6.1 边缘节点

```text
正常数 / 总数
```

- 总数：NodeGroup 显式配置的节点数；如果没有显式节点列表，则使用 NodeGroup 实际解析出的节点数。
- 正常数：上述节点中 Kubernetes Ready 状态正常的节点数。

示例：

```text
1/1 = NodeGroup 中有 1 个节点，其中 1 个 Ready
```

### 6.2 工作负载

当前工作负载统计对象为 Deployment：

```text
正常数 / 总数
```

- 总数：明确归属于 EdgeUnit/NodeGroup，或者已有 Pod 实际运行在 NodeGroup 节点上的 Deployment 数量。
- 正常数：这些 Deployment 中，至少有一个同 Namespace、未标记删除、匹配 Deployment selector 的 Pod，在 NodeGroup 节点上处于 `Running` 且 `Ready=True` 的数量。

因此，`1/1` 表示有一个归属该 EdgeUnit 的 Deployment，并且它至少有一个 Ready Pod 实际运行在对应节点组中。

这是当前代码口径，不等同于“全部期望副本都正常”。例如期望 10 个副本但只有 1 个 Ready，当前仍会把该 Deployment 计入正常数；`replicas=0` 且没有 Ready Pod 时不会计为正常。若产品要求严格可用，应将健康条件调整为 `NodeGroup 内 Ready Pod 数 >= spec.replicas`。Deployment 全局 `availableReplicas` 只有在所有副本均被强制限制到该 NodeGroup 时才能作为辅助判断，不能单独证明 NodeGroup 内副本健康。

### 6.3 应用实例

需要特别说明：当前 EdgeUnit 卡片中的“应用实例”统计，代码口径实际是 **EdgeApplication 资源数量**，不是 Deployment 的 Pod 副本数。

```text
正常数 / 总数
```

- 总数：明确指向 EdgeUnit 或其 NodeGroup 的 EdgeApplication 数量。
- 正常数：依次读取 `status.phase`、`status.status`、`status.state` 中第一个有值的字段，转为小写后等于 `ready`、`running`、`success`、`succeeded` 或 `available` 的 EdgeApplication 数量。无状态或未知状态不计入正常数。

如果产品希望这里展示 Pod 副本数量，需要另行调整字段命名和后端统计口径。为避免歧义，后续可考虑将页面文案改为“边缘应用”，或者增加单独的“Pod 实例”指标。

## 7. Namespace 与 EdgeUnit 的关系

Namespace 是 Cluster 内部的 Kubernetes 逻辑隔离维度，不直接属于某个 EdgeUnit。

因此，EdgeUnit 工作台中的 Namespace 下拉框可以展示当前 Cluster 下的全部 Namespace，用于选择和筛选；但选择 Namespace 后，列表仍必须继续应用 EdgeUnit/NodeGroup 归属过滤。

正确查询关系：

```text
Cluster Namespace 范围
        ∩
EdgeUnit / NodeGroup 资源归属范围
        =
页面最终展示资源
```

不能因为用户选择了某个 Namespace，就展示该 Namespace 下属于其他 EdgeUnit 或普通集群节点的全部工作负载。

## 8. 创建和绑定流程

当前采用创建后绑定方案：

```text
创建 EdgeUnit
    └── 选择 Cluster
        └── 创建完成
            └── EdgeUnit 详情/编辑
                └── 绑定已有 NodeGroup
```

选择该方案的原因：

- 兼容先创建边缘单元、后接入节点的实际流程。
- EdgeUnit 创建时 NodeGroup 可能尚未准备完成。
- 不强制用户在创建入口提前完成全部基础资源准备。

约束：未绑定有效 NodeGroup 时，后端必须拒绝普通工作负载和批量工作负载创建；前端禁用创建入口只是体验增强，不能替代后端强制校验。

## 9. 无 NodeGroup 时的强制行为

以下情况统一视为 EdgeUnit 没有有效资源范围：

- `nodeGroupRef` 为空。
- `nodeGroupRef` 引用的 NodeGroup 不存在。

页面统计必须为：

```text
边缘节点：0/0
工作负载：0/0
应用实例：0/0
```

同时：

- 不得回退到整个 Cluster。
- 不得按 Namespace 直接纳入全部资源。
- 不得允许工作负载绕过 NodeGroup 调度约束。

如果 NodeGroup 对象存在但没有显式节点或标签选择器，当前读取统计与“NodeGroup 不存在”不同：

- 节点统计为 `0/0`。
- 新建 Deployment 时后端拒绝，错误为绑定的 NodeGroup 没有配置节点或节点标签选择器。
- 已存在且带有归属标签的 Deployment、EdgeApplication 仍可能进入总数，但由于没有 NodeGroup 节点，Deployment 不会被判定为健康。

如果 NodeGroup 已配置合法标签选择器、但当前暂时匹配零节点：

- 节点统计同样为 `0/0`。
- 后端允许创建 Deployment，并写入该 `nodeSelector`；Pod 会等待符合选择器的节点出现，当前可能处于 Pending。
- 显式归属的 Deployment、EdgeApplication 可以进入总数，但在出现 Ready Pod 前 Deployment 不计为健康。

## 10. 历史数据兼容

| 历史数据情况 | 处理方式 |
| --- | --- |
| EdgeUnit 已有有效 `nodeGroupRef` | 按 NodeGroup 继续统计 |
| EdgeUnit 没有 `nodeGroupRef` | 返回全部零值，不回退到 Cluster |
| Deployment 已有 EdgeUnit/NodeGroup 标签 | 按标签归属 |
| Deployment 无归属标签，但 Pod 已运行在 NodeGroup 节点 | 作为历史兼容纳入当前 NodeGroup |
| EdgeApplication 已有 `targetNodeGroups` | 按目标 NodeGroup 归属 |
| 资源只与 EdgeUnit 位于同一 Cluster/Namespace | 不视为归属于该 EdgeUnit |

### 10.1 当前冲突与共享边界

当前 BlueEdge 正常创建路径会写入一致的 EdgeUnit、NodeGroup 标签和调度约束，但手工 YAML、历史资源或外部控制器仍可能制造冲突。当前实现边界如下：

- Deployment 的 EdgeUnit 标签、NodeGroup 标签和实际运行节点采用“任一匹配即可”的兼容逻辑；冲突数据可能同时进入两个 EdgeUnit 总数。
- EdgeApplication 的 EdgeUnit 标签和 `targetNodeGroups` 同样采用任一匹配逻辑；多个目标 NodeGroup 可以使一个应用被多个 EdgeUnit 统计。
- 当前绑定逻辑不校验 NodeGroup 是否已被其他 EdgeUnit 引用；若多个 EdgeUnit 引用同一个 NodeGroup，它们会共享节点范围并可能重复统计资源。
- 用户已有 NodeAffinity 会被保留并追加 NodeGroup 的 hostname 条件；当前显式冲突校验重点覆盖 `nodeName` 和 `nodeSelector`。
- 后续手工修改 Kubernetes 资源绕过 BlueEdge API 时，平台只能在读取阶段识别现状，不能保证自动纠正全部越界配置。

因此，生产数据应保持一个 EdgeUnit 对应一个明确 NodeGroup、归属标签相互一致。若产品要求强隔离，还需要继续增加 NodeGroup 唯一绑定、冲突标签拒绝和读取去重规则。

## 11. 典型场景与期望结果

### Case 1：EdgeUnit 未绑定 NodeGroup

```yaml
clusterName: kubernetes
nodeGroupRef: ""
```

期望：

```text
nodes = 0/0
workloads = 0/0
applications = 0/0
```

### Case 2：EdgeUnit 绑定有效 NodeGroup

```yaml
nodeGroupRef: laptop-edge-group
```

NodeGroup：

```yaml
spec:
  nodes:
    - k8s-laptop-edge
```

期望：

- 节点列表包含 `k8s-laptop-edge`。
- 节点 Ready 时统计为 `1/1`。
- 只有归属该 EdgeUnit/NodeGroup 的 Deployment 和 EdgeApplication 被统计。

### Case 3：多个 EdgeUnit 使用同一 Cluster

```text
edge-unit-a → node-group-a
edge-unit-b → node-group-b
```

期望：

- A 只统计 A 节点组的节点和资源。
- B 只统计 B 节点组的节点和资源。
- 两个 EdgeUnit 之间不能因 `clusterName` 相同而互相污染。

### Case 4：工作负载试图指定其他节点组的节点

期望：

- 后端拒绝创建或更新。
- 返回目标节点不属于当前 NodeGroup 的明确错误。
- 不产生跨 EdgeUnit 调度资源。

### Case 5：Namespace 展示集群全部选项

期望：

- Namespace 下拉框可以列出 Cluster 中的 Namespace。
- 选择 Namespace 后，只展示该 Namespace 与当前 EdgeUnit 归属范围的交集。

### Case 6：NodeGroup 存在但没有节点配置或选择器

期望：

- 节点统计为 `0/0`。
- 新建 Deployment 被后端拒绝。
- 已有显式归属的 Deployment 或 EdgeApplication 可能仍进入总数。
- Deployment 因没有 Ready Pod 运行在 NodeGroup 节点上，正常数为 0。

### Case 6.1：NodeGroup 有合法选择器但暂时匹配零节点

期望：

- 节点统计为 `0/0`。
- 后端允许创建带有该 `nodeSelector` 的 Deployment。
- Pod 在没有匹配节点时可能处于 Pending。
- Deployment 进入总数，但在没有 Ready Pod 前不进入正常数。

### Case 7：Deployment 只有部分副本 Ready

例如期望副本数为 10，但 NodeGroup 中只有 1 个匹配 Pod 为 Ready。

当前期望：该 Deployment 仍计为一个正常工作负载。这是当前实现口径，不代表全部副本可用。

### Case 8：归属标签或目标 NodeGroup 冲突

期望：

- BlueEdge 正常创建接口不会产生冲突标签。
- 对手工制造的冲突资源，应记录为已知脏数据风险并人工修正。
- 在增加强冲突校验之前，不能假设该资源只会被一个 EdgeUnit 统计。

## 12. 关键实现文件

### 后端

- `server/api-gateway/src/routes/edge-unit.routes.ts`
  - EdgeUnit 查询、创建、更新和工作负载操作路由。
- `server/api-gateway/src/services/edge-unit.service.ts`
  - EdgeUnit 与 NodeGroup 绑定、Deployment 归属、调度约束、统计口径的核心实现。
- `server/api-gateway/src/services/edge-unit-source.service.ts`
  - EdgeUnit、NodeGroup、Node、Deployment、Pod、EdgeApplication 的共享数据聚合来源。
- `server/api-gateway/src/services/batch-workload.service.ts`
  - 批量工作负载继承 EdgeUnit NodeGroup、写入归属标签并创建真实 Deployment。
- `server/api-gateway/src/services/edgeapplication-proxy.service.ts`
  - EdgeApplication 的 `workloadScope.targetNodeGroups` 处理。

### 前端

- `frontend/src/pages/Deployments.tsx`
  - 普通工作负载创建，显示当前目标 NodeGroup，未绑定时禁止创建。
- `frontend/src/pages/BatchWorkloads.tsx`
  - 批量工作负载自动继承当前 EdgeUnit 的 NodeGroup。
- `frontend/src/pages/EdgeApps.tsx`
  - 边缘应用写入 EdgeUnit 标签及目标 NodeGroup。
- EdgeUnit 列表和详情相关页面
  - 展示 NodeGroup 绑定信息与后端返回的真实统计数据。

## 13. 验收标准

- [ ] EdgeUnit 无 `nodeGroupRef` 时三个资源指标均为 `0/0`。
- [ ] EdgeUnit 绑定 NodeGroup 后，只显示该 NodeGroup 的节点。
- [ ] 普通工作负载创建后带有 EdgeUnit、NodeGroup 标签和调度约束。
- [ ] 批量工作负载自动继承当前 EdgeUnit 的 NodeGroup。
- [ ] EdgeApplication 明确写入 EdgeUnit 或 `targetNodeGroups` 归属信息。
- [ ] 多个 EdgeUnit 共用 Cluster 时统计互不污染。
- [ ] Namespace 下拉可以展示集群选项，但资源列表仍按 EdgeUnit 过滤。
- [ ] 指定其他 NodeGroup 节点或冲突选择器时后端拒绝请求。
- [ ] 历史 EdgeUnit 没有 NodeGroup 时不再回退统计整个 Cluster。
- [ ] NodeGroup 没有显式节点且没有选择器时，节点为 `0/0` 且后端拒绝新建 Deployment。
- [ ] NodeGroup 有合法选择器但匹配零节点时，后端允许创建，Pod Pending，工作负载正常数保持为 0。
- [ ] Deployment 与用于健康判断的 Pod 必须处于相同 Namespace。
- [ ] 部分副本 Ready 时的页面结果符合当前“至少一个 Ready Pod”口径。
- [ ] EdgeApplication 无状态或未知状态时只进入总数，不进入正常数。
- [ ] 冲突标签、共享 NodeGroup 和多目标 NodeGroup 被作为已知风险验证，不误判为已经实现强隔离。

## 14. 验证命令

```bash
cd frontend
npm run build
```

```bash
cd server/api-gateway
npm run build
npm test
```

真实环境验收时还应检查：

```bash
kubectl get nodegroup laptop-edge-group -A -o yaml
kubectl get node k8s-laptop-edge -o yaml
kubectl get deployment -A --show-labels
kubectl get pod -A -o wide --show-labels
```

通过网关检查 EdgeUnit 卡片和资源明细：

```bash
curl -s http://127.0.0.1:7001/blueedge/edge-units/demo-edge-unit
curl -s http://127.0.0.1:7001/blueedge/edge-units/demo-edge-unit/resources
```

如果环境启用了登录鉴权，应按实际登录流程携带 Bearer Token。至少断言：

- 无 `nodeGroupRef` 时 `nodes`、`workloads`、`applications` 的正常数和总数均为 0。
- 有 NodeGroup 时，资源明细中的节点名称只来自该 NodeGroup。
- 同一 Cluster 的其他 EdgeUnit 资源不出现在当前响应中。
- 未绑定 NodeGroup 时，`POST /blueedge/edge-units/:name/deployments` 返回失败，不能创建真实 Deployment。

重点确认 Deployment/Pod 的归属标签、调度约束和实际运行节点是否一致。

## 15. 最终结论

BlueEdge EdgeUnit 的资源边界由 `nodeGroupRef` 决定，而不是由 `clusterName` 或 Namespace 决定。

```text
Cluster：决定去哪里查
EdgeUnit：产品管理边界
NodeGroup：决定管理哪些节点
Node：承载 Pod
Deployment：定义工作负载并生成 Pod
Pod：证明工作负载实际运行在哪些节点
EdgeApplication：通过 EdgeUnit/NodeGroup 目标声明归属
Namespace：集群内的查询与隔离维度，不是 EdgeUnit 归属边界
```

任何 `nodeGroupRef` 为空或引用的 NodeGroup 对象不存在的 EdgeUnit，都必须返回零资源，禁止回退到整个 Kubernetes 集群。NodeGroup 对象存在但暂时没有匹配节点时，按照第 9 节的当前实现口径处理。
