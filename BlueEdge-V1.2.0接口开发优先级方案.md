# BlueEdge V1.2.0 接口开发优先级方案

## 1. 背景

BlueEdge V1.2.0 前端页面已经完成较多原型和样式迁移，但当前页面的数据来源存在三类状态：

- 已接真实接口：通过 `frontend/src/api/services/*` 调用官方 BFF 或 BlueEdge `api-gateway`。
- 半对接：页面能拉真实接口，但仍混入 `mock`、本地 fallback 或本地假成功。
- 纯本地 mock：页面存在，但列表、创建、编辑、删除仍由 `initialXXX` 或 `useState` 本地维护。

本方案用于确定第一轮接口开发优先级，目标是先让 V1.2.0 关键页面从 mock 切到真实接口，再逐步把复杂聚合能力从前端 adapter 下沉到 BlueEdge 后端能力层。

## 2. 接口分层原则

当前建议保留现有总体链路：

```text
BlueEdge 前端
  -> frontend services
  -> frontend adapters
  -> BlueEdge api-gateway
      -> 官方 KubeEdge Dashboard BFF
      -> BlueEdge K8S 对接层 / 自研聚合能力
          -> Kubernetes 原生 API
          -> KubeEdge CRD API
```

分工原则：

- 官方 BFF 已支持的标准资源 CRUD，继续复用官方 BFF。
- 官方 BFF 不支持的 PV/PVC、metrics、events、logs、首页聚合、批量任务、节点接入等能力，由 `api-gateway` 扩展。
- 前端 adapter 只做轻量字段适配、状态显示、空值兜底。
- 多资源 join、分页、筛选、状态聚合、运行态判断，不建议继续放在前端页面或 adapter。

接口路径建议：

- `/product-api/bff/*`：官方 BFF 透传或已有 BFF 能力。
- `/product-api/blueedge/*`：BlueEdge 自研聚合能力、K8S 直连能力、V1.2.0 新增接口。

## 3. P0：第一轮必须补

P0 定义：页面已经存在，但当前仍是 mock、本地状态，或者无法完整展示，必须优先补接口。

| 接口路径 | 方法 | 所属模块 | 数据来源 | 前端对应页面 | 返回字段草案 | 是否需要新增后端 service | 是否需要新增前端 adapter | 开发复杂度 | 风险点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/blueedge/edge-units` | GET | 边缘单元 | BlueEdge 自研聚合：NodeGroup + Node + Deployment + EdgeApplication | `Home.tsx`、`Dashboard.tsx` | `items[{name,status,access,cluster,version,createdAt,nodes,workloads,apps,protocols,ports,description}]` | 是 | 是 | 高 | “边缘单元”是否等同 NodeGroup 需要先统一模型，否则后续创建、删除语义会不清晰。 |
| `/blueedge/edge-units` | POST | 边缘单元 | BlueEdge 自研聚合，可短期落 NodeGroup/ConfigMap/annotation | `Home.tsx` | `{name,status,rawRefs}` | 是 | 是 | 高 | 如果没有真实 CRD，容易形成“前端有资源、集群无资源”的伪模型。 |
| `/blueedge/edge-units/:name` | PUT/DELETE | 边缘单元 | BlueEdge 自研聚合 | `Home.tsx` | `{name,status,rawRefs}` 或 204 | 是 | 是 | 高 | 删除是否级联 NodeGroup、Namespace、应用，需要明确策略。 |
| `/blueedge/access/configs` | GET | 节点接入 | BlueEdge 自研配置 + K8S Secret/ConfigMap | `AccessNodePage.tsx`、`Nodes.tsx` 接入 tab | `items[{name,driver,address,protocol,registry,labels,tokenStatus,createdAt,description}]` | 是 | 是 | 中 | token、registry credential 不能明文返回。 |
| `/blueedge/access/configs` | POST | 节点接入 | BlueEdge 自研配置 | `AccessNodePage.tsx`、`Nodes.tsx` 接入 tab | `{name,labels,installCommand,downloadUrl}` | 是 | 是 | 中 | 接入节点不是创建 Node，页面文案和接口语义不能误导为 `POST /node`。 |
| `/blueedge/access/configs/:name` | PUT/DELETE | 节点接入 | BlueEdge 自研配置 | `AccessNodePage.tsx`、`Nodes.tsx` 接入 tab | 更新后的 config 或 204 | 是 | 是 | 中 | 删除配置后已接入节点如何处理，需要定义只删配置还是影响节点。 |
| `/blueedge/access/packages/:name/download` | GET | 节点接入 | 安装包目录、对象存储或动态脚本生成 | `AccessNodePage.tsx` | 文件流或脚本文本 | 是 | 否 | 中 | 需要处理下载鉴权、文件路径穿越、架构版本匹配。 |
| `/bff/deployment` | GET | 工作负载 | 官方 BFF | `Deployments.tsx` | 复用 BFF，前端转为 `{name,alias,status,namespace,readyReplicas,replicas,image,createdAt}` | 否 | 是 | 低 | 新版页面当前是 `initialWorkloads`，应先恢复真实列表。 |
| `/bff/deployment/:namespace` | GET | 工作负载 | 官方 BFF | `Deployments.tsx` | 同上，按 namespace 过滤 | 否 | 是 | 低 | 命名空间筛选要和页面 selector 统一。 |
| `/bff/deployment/:namespace` | POST/PUT | 工作负载 | 官方 BFF | `Deployments.tsx` | Kubernetes Deployment 原始对象 | 否 | 是 | 中 | 表单高级字段需要生成合法 Deployment YAML。 |
| `/bff/deployment/:namespace/:name` | DELETE | 工作负载 | 官方 BFF | `Deployments.tsx` | 204 或操作结果 | 否 | 否 | 低 | 删除后必须重新拉列表，不能本地删除假成功。 |
| `/blueedge/workloads/batch` | POST | 批量工作负载 | BlueEdge 聚合 + K8S Deployment API | `BatchWorkloads.tsx` | `{taskId,total,success,failed,items[{name,namespace,status,message}]}` | 是 | 是 | 高 | 需要定义部分成功、回滚、重复名称、命名空间权限。 |
| `/blueedge/workloads/batch/:taskId` | GET | 批量工作负载 | BlueEdge 任务状态 | `BatchWorkloads.tsx` | `{taskId,status,progress,items,errors,createdAt,finishedAt}` | 是 | 是 | 高 | 如果没有持久化，页面刷新后任务状态会丢。 |
| `/blueedge/batch-tasks` | GET | 批量任务 | BlueEdge 自研任务 / K8S Job 聚合 | `BatchTasks.tsx` | `items[{id,name,type,status,image,version,targetNodes,progress,createdAt,description}]` | 是 | 是 | 高 | 任务状态机和任务存储方式要先定。 |
| `/blueedge/batch-tasks/upgrade` | POST | 节点升级 | BlueEdge 自研任务 + K8S Job/DaemonSet | `BatchTasks.tsx` | `{id,status,targetNodes,steps}` | 是 | 是 | 高 | 真实节点升级风险高，第一轮可先做任务记录和计划态。 |
| `/blueedge/batch-tasks/image-preheat` | POST | 镜像预热 | K8S DaemonSet/Job + 节点选择 | `BatchTasks.tsx` | `{id,status,targetNodes,images,steps}` | 是 | 是 | 高 | 镜像仓库凭据、节点选择、失败重试需要统一设计。 |
| `/bff/configmap` | GET | 配置项 | 官方 BFF | `ConfigMaps.tsx` | `items[{name,namespace,type,labels,dataCount,createdAt,mountTargets}]` | 否 | 是 | 低 | 官方 BFF 已有能力，当前新版页面未接。 |
| `/bff/secret` | GET | 密钥 | 官方 BFF | `ConfigMaps.tsx` | `items[{name,namespace,type,labels,dataCount,createdAt,mountTargets}]` | 否 | 是 | 低 | Secret 数据展示必须脱敏。 |
| `/bff/configmap/:namespace` | POST/PUT | 配置项 | 官方 BFF | `ConfigMaps.tsx` | ConfigMap 原始对象 | 否 | 是 | 中 | YAML 创建和表单创建要共用资源构造逻辑。 |
| `/bff/secret/:namespace` | POST/PUT | 密钥 | 官方 BFF | `ConfigMaps.tsx` | Secret 原始对象 | 否 | 是 | 中 | Secret 的 data/stringData 编码策略必须统一。 |
| `/bff/configmap/:namespace/:name` | DELETE | 配置项 | 官方 BFF | `ConfigMaps.tsx` | 204 或操作结果 | 否 | 否 | 低 | 删除前引用关系目前不准确，第一轮可先提示风险。 |
| `/bff/secret/:namespace/:name` | DELETE | 密钥 | 官方 BFF | `ConfigMaps.tsx` | 204 或操作结果 | 否 | 否 | 低 | 删除 Secret 可能影响镜像拉取或环境变量，需要前端提示。 |

## 4. P1：已有接口但需要增强或聚合

P1 定义：已有接口可用，但字段不完整，或复杂聚合散落在前端，需要后端增强。

| 接口路径 | 方法 | 所属模块 | 数据来源 | 前端对应页面 | 返回字段草案 | 是否需要新增后端 service | 是否需要新增前端 adapter | 开发复杂度 | 风险点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/blueedge/nodes/:name/summary` | GET | 节点 | K8S Node + Pod + Metrics + Events + 接入配置 | `Nodes.tsx` | `{node,metrics,pods,events,accessConfig,conditions,labels}` | 是 | 是 | 中 | metrics-server 不可用时要降级返回。 |
| `/blueedge/nodegroups/:name/summary` | GET | 节点组 | KubeEdge NodeGroup CRD + Node label 匹配 | `NodeGroups.tsx` | `{name,selectorType,nodes,matchedNodes,labels,description,status,raw}` | 是 | 是 | 中 | NodeGroup 的 `spec.nodes`、`matchLabels`、描述字段要按真实 CRD 校验。 |
| `/blueedge/edgeapps/:namespace/:name/summary` | GET | 边缘应用 | EdgeApplication CRD + Deployment + Pod + Events | `EdgeApps.tsx` | `{app,status,workload,pods,nodeGroups,events,yaml}` | 是 | 是 | 中高 | 当前运行态判断在页面内，后移时要保持口径一致。 |
| `/blueedge/pods/:namespace/:name/summary` | GET | Pod | Pod + metrics + events + logs | `Pods.tsx` | `{pod,containers,metrics,events,recentLogs}` | 是 | 是 | 中 | 日志量、容器选择、日志超时需要控制。 |
| `/blueedge/devicemodels/:namespace/:name/summary` | GET | 设备模型 | KubeEdge DeviceModel CRD | `DeviceModels.tsx` | `{name,namespace,protocol,properties,labels,description,raw}` | 是 | 是 | 中 | 当前页面有 mock fallback，增强时要改成真实失败提示。 |
| `/blueedge/devices/:namespace/:name/summary` | GET | 设备实例 | Device CRD + DeviceModel + Node | `DeviceInstances.tsx` | `{name,namespace,model,node,status,twins,access,labels,raw}` | 是 | 是 | 中高 | twin 状态字段复杂，必须按真实 Device CRD 验证。 |
| `/blueedge/observability/resources/:kind/:namespace/:name` | GET | 观测 | metrics.k8s.io + Events + Pod logs | `Nodes.tsx`、`Deployments.tsx`、`EdgeApps.tsx`、`Pods.tsx` | `{metrics,events,logs,stale}` | 是 | 是 | 中 | 不同资源的日志来源不同，Deployment/EdgeApp 需要先找 Pod。 |
| `/blueedge/storage/persistentvolumes/summary` | GET | 存储 | K8S PV + PVC + StorageClass | `PersistentVolumes.tsx` | `items[{name,status,capacity,accessModes,reclaimPolicy,storageClass,claim,createdAt}]` | 是 | 可选 | 中 | 官方 BFF 无 PV/PVC，继续走 gateway K8S 直连。 |
| `/blueedge/storage/persistentvolumeclaims/summary` | GET | 存储 | K8S PVC + PV + Pod/Deployment 引用 | `PersistentVolumeClaims.tsx` | `items[{namespace,name,status,capacity,storageClass,volume,usedBy,createdAt}]` | 是 | 可选 | 中 | 引用关系扫描成本较高，需注意性能和权限。 |

## 5. P2：后续优化项

P2 定义：不影响第一轮交付，但能提升体验、可维护性或运维能力。

| 接口路径 | 方法 | 所属模块 | 数据来源 | 前端对应页面 | 返回字段草案 | 是否需要新增后端 service | 是否需要新增前端 adapter | 开发复杂度 | 风险点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/blueedge/dashboard/summary` | GET | 仪表盘 | BlueEdge 聚合 | `Dashboard.tsx` | `{edgeUnits,nodes,workloads,devices,rules,events,metrics}` | 是 | 是 | 中 | 与 `/blueedge/edge-units` 的统计口径不能冲突。 |
| `/blueedge/storage/classes` | GET | 存储 | K8S StorageClass API | PV/PVC 创建弹窗 | `items[{name,provisioner,reclaimPolicy,default}]` | 是 | 是 | 低 | 没有 StorageClass 权限时要允许用户手输。 |
| `/blueedge/configs/:namespace/:name/references` | GET | 配置引用 | Pod/Deployment/EdgeApp 扫描 | `ConfigMaps.tsx` | `{usedBy[{kind,namespace,name,path}]}` | 是 | 是 | 中 | 全集群扫描成本较高，第一轮可不做。 |
| `/blueedge/version` | GET | 系统信息 | 官方 BFF `/version` + gateway info | Dashboard / 关于页 | `{kubernetesVersion,kubeEdgeVersion,blueedgeVersion}` | 可选 | 是 | 低 | KubeEdge 版本来源可能不稳定。 |
| `/blueedge/export/:kind/:namespace/:name/yaml` | GET | YAML 导出 | BFF 或 K8S API | 各详情页 | `{yaml}` 或文件流 | 是 | 否 | 低 | 要清理 `managedFields`、`resourceVersion`、`uid`、`status` 等运行时字段。 |
| `/blueedge/tasks/:id/logs` | GET | 任务日志 | Job Pod logs | `BatchTasks.tsx` | `{lines,nextToken}` | 是 | 是 | 中 | 日志分页和 Pod 消失后的保留策略需要设计。 |

## 6. 建议开发顺序

### 第一阶段：低成本真实化

优先把官方 BFF 已经支持、但新版页面仍然 mock 的页面接回来：

1. `Deployments.tsx`
   - 接 `GET /bff/deployment`
   - 接 `POST /bff/deployment/:namespace`
   - 接 `DELETE /bff/deployment/:namespace/:name`
   - 删除 `initialWorkloads` 主数据源

2. `ConfigMaps.tsx`
   - 接 `GET /bff/configmap`
   - 接 `GET /bff/secret`
   - 接 ConfigMap/Secret 的创建、编辑、删除
   - Secret 内容做脱敏展示

### 第二阶段：V1.2.0 新增后端能力

优先补必须支撑新页面的 BlueEdge 自研接口：

1. `/blueedge/edge-units`
2. `/blueedge/access/configs`
3. `/blueedge/access/packages/:name/download`
4. `/blueedge/batch-tasks`
5. `/blueedge/workloads/batch`

这些接口建议落在 `api-gateway` 内部新增 service 中，而不是新增独立后端服务。

### 第三阶段：聚合接口后移

把当前散落在前端页面中的复杂聚合能力逐步后移：

1. `/blueedge/nodes/:name/summary`
2. `/blueedge/nodegroups/:name/summary`
3. `/blueedge/edgeapps/:namespace/:name/summary`
4. `/blueedge/pods/:namespace/:name/summary`
5. `/blueedge/devices/:namespace/:name/summary`
6. `/blueedge/observability/resources/:kind/:namespace/:name`

## 7. 后端模块建议

建议在 `server/api-gateway/src` 下逐步拆分，而不是继续把所有逻辑堆在 `index.ts`：

```text
server/api-gateway/src/
  config.ts
  clients/
    bff-client.ts
    k8s-client.ts
  services/
    edge-unit.service.ts
    access-node.service.ts
    batch-task.service.ts
    workload.service.ts
    node-summary.service.ts
    edgeapp-summary.service.ts
    storage-summary.service.ts
    observability.service.ts
  adapters/
    edge-unit.adapter.ts
    node-summary.adapter.ts
    workload.adapter.ts
    edgeapp.adapter.ts
  routes/
    edge-unit.routes.ts
    access-node.routes.ts
    batch-task.routes.ts
    workload.routes.ts
    summary.routes.ts
```

其中：

- `clients/bff-client.ts`：封装官方 BFF 调用。
- `clients/k8s-client.ts`：封装 K8S API 请求、token、apiserver、错误处理。
- `services/*`：处理多资源聚合、筛选、分页、状态判断。
- `adapters/*`：把 K8S/BFF 原始对象转成 BlueEdge 页面字段。
- `routes/*`：负责参数校验和 HTTP response，不承载复杂业务逻辑。

## 8. 主要风险

1. 边缘单元模型不清晰
   - 需要确认它是 NodeGroup 聚合、Namespace 聚合，还是未来 BlueEdge 自研 CRD。

2. 前端 mock fallback 可能掩盖真实接口失败
   - P0 页面接入时，建议失败就展示错误或空态，不再混入假数据。

3. 批量任务需要状态持久化
   - 如果只存在内存中，页面刷新、gateway 重启都会丢任务状态。

4. metrics-server 不是强依赖
   - metrics 不可用时，接口应返回降级状态，而不是让整个页面失败。

5. Secret 和 token 安全
   - Secret 内容、节点接入 token、镜像仓库凭据必须脱敏或只返回状态。

6. 官方 BFF 和 BlueEdge 聚合层边界要稳定
   - 标准资源 CRUD 继续复用 BFF。
   - 新字段、新页面、跨资源聚合走 BlueEdge K8S 对接层。

## 9. 第一轮交付建议

第一轮建议只追求“页面从 mock 切到真实数据”和“核心操作不再本地假成功”：

1. `Deployments.tsx` 接回官方 BFF。
2. `ConfigMaps.tsx` 接回官方 BFF。
3. `Home.tsx` / `Dashboard.tsx` 接 `/blueedge/edge-units` 只读列表。
4. `AccessNodePage.tsx` 接接入配置列表和下载接口。
5. `BatchTasks.tsx` / `BatchWorkloads.tsx` 先接任务创建和任务状态查询。

第二轮再做节点、边缘应用、Pod、设备、存储的 summary 聚合接口。

## 10. 第二轮：前端 Mock 与假能力收口

> 2026-07-13 审计补充。本轮只记录修复计划；审计过程中未修改 `frontend/src` 业务代码。

### 10.1 P0：先消除验收阻塞项

1. 统一全局 EdgeUnit 上下文
   - 删除 `components/layout/Header.tsx` 中硬编码的 EdgeUnit 列表。
   - 删除 `components/layout/Sidebar.tsx` 中固定的 `edge-131`、集群名和版本。
   - Header、Sidebar 与业务页面共用 `/blueedge/edge-units` 的真实选中项。
   - 切换 EdgeUnit 后必须真正刷新或筛选当前页面数据，禁止只修改 Header 本地状态。

2. 收口 Rules 页面假数据
   - 删除 `pages/Rules.tsx` 的 `fallbackEndpoints`、`fallbackRoutes` 生产数据降级。
   - 接口为空时显示真实空态，接口失败时显示错误态，不回填示例规则。
   - 保存失败后不得在本地插入或更新规则并提示成功。
   - 静态事件、静态审计面板隐藏、禁用或明确标注“暂未开放”。

3. 禁止无接口的写操作假成功
   - `pages/Deployments.tsx` 的停止、重启入口在没有真实 API 前禁用或标注“暂未开放”。
   - `pages/Nodes.tsx` 的别名保存若无持久化接口，应禁用或明确标注仅本地临时展示。
   - `pages/BatchTasks.tsx` 的启动、取消操作必须等待真实请求完成后再提示结果。

### 10.2 P1：清理静态详情和无效操作

1. Deployment 详情不得展示硬编码容器、环境变量、调度配置；优先从 `raw` 解析，缺失时显示空态。
2. BatchWorkload 定义详情不得展示固定生命周期、健康检查、标签和访问地址；从任务原始配置解析，缺失时标注未配置。
3. Node CPU/内存进度条必须使用真实 metrics；不可用时显示 `available=false` 对应降级态，不使用固定百分比。
4. Header、Dashboard、Namespace、Deployment Pod/Event、BatchTask 详情中的刷新按钮必须执行真实重新查询；否则禁用或移除。
5. `useNamespaceOptions.ts` 的 `default` namespace 兜底可以保留，但接口失败应向页面暴露 warning/error，避免静默掩盖故障。

### 10.3 P2：模板和死代码治理

1. 保留不进入资源主数据流的表单模板：默认 YAML、默认镜像、默认字段、表单初始化值。
2. 保留明确的空态和降级值：`[]`、`null`、`unknown`、`available=false`。
3. 删除无引用的 `data/mockData.ts`。
4. 确认无动态引用后删除未使用的 `components/ui/sidebar.tsx`。
5. 删除 `Nodes.tsx`、`NodeGroups.tsx` 中已无生产来源的 `localOnly` 兼容分支。
6. 登录页粒子动画中的 `Math.random` 和纯 UI 定时器不属于业务 Mock，可以保留。

### 10.4 第二轮验收标准

1. MainLayout 与 Dashboard 展示同一个真实 EdgeUnit，刷新页面后选中上下文和资源数据一致。
2. EdgeUnit 接口失败时只出现 loading、empty、error 或 warnings，不出现硬编码 EdgeUnit。
3. Rules 接口为空或失败时不出现示例规则；失败写操作不改变本地列表。
4. 所有可点击的保存、停止、重启、启动、取消操作均有真实 API，或已禁用并标注未开放。
5. Deployment、BatchWorkload、Node 详情不展示无法由接口证明的静态值。
6. 所有刷新按钮均触发真实请求；无实现的刷新入口不对用户开放。
7. 全量搜索后，生产数据流中的主数据 Mock 和假写操作均为 0。
8. 完成 frontend build、gateway smoke test，并人工验证页面刷新和 Gateway 重启后的数据一致性。
