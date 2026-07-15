# BlueEdge V1.2.0 前端可点击功能与后端接口映射审计报告

> 审计范围：`frontend/src`  
> 审计日期：2026-07-14  
> 审计方式：静态代码审计，本轮未修改业务代码

## 一、审计口径

- 检出原始事件绑定：**1064** 处
  - `onClick`：593
  - `onChange`：447
  - `onSubmit`：14
  - `onSelect`：8
  - `onConfirm`：2
- 检出按钮、菜单、链接类 JSX：**306** 处。
- 将输入框联动、同一弹窗步骤、重复行菜单等归并后，得到 **203 个用户可感知功能入口**。
- API 基础路径：
  - BFF：`/product-api/bff`
  - Gateway：`/product-api`
  - 定义位置：`frontend/src/api/request.ts`

## 二、核心结论

当前**不能**判定“所有可交互能力已真实化”。

- 主体 CRUD、Summary、Observability、Batch planOnly 已真实接入。
- 未发现“先提示成功、后发送请求”的错误顺序。
- 未发现请求失败后仍弹成功提示。
- 仍有 **3 项 P0 部分假写入**：请求确实发送，但部分用户填写字段没有进入 payload。
- 仍有若干空按钮、错误刷新入口和明确未实现能力。
- 当前需要后端能力的功能接入率约为 **87.4%**。

## 三、完整按钮接口矩阵

> 表中同一页面的搜索、分页、表单字段、弹窗开关等同类入口做了归并。

| 页面 | 功能入口 | 分类 | Service / Handler | HTTP 方法及路径 | 失败处理 | 状态 |
|---|---|---:|---|---|---|---|
| Login | 登录 | A | `loginRequest` → `login` | `POST /product-api/auth/login` | 返回 `false`，清除 Token，不跳转 | 已接入 |
| Login | 密码显示、背景动画 | B | 本地状态/Canvas | 无 | 不涉及业务数据 | 纯前端合理 |
| Header | 刷新 EdgeUnit | A | `refreshEdgeUnits` → `listEdgeUnits` | `GET /product-api/blueedge/edge-units` | Context 保存错误 | 已接入 |
| Header | EdgeUnit 切换、退出登录 | B | Context 切换；清除本地 Token | 无退出接口 | 不伪造资源结果 | 纯前端合理 |
| Header | 通知、个人设置 | D | 无 handler | 无 | 无错误反馈 | 空操作 |
| Sidebar | 页面跳转、折叠 | B | React Router、本地状态 | 无 | 不涉及业务数据 | 纯前端合理 |
| Home | EdgeUnit 列表/刷新 | A | `loadData` → `listEdgeUnits`、`listNodeGroups` | `GET /blueedge/edge-units`；`GET /bff/nodegroup` | 清空列表并展示错误 | 已接入 |
| Home | 创建/编辑/删除 EdgeUnit | A | `createEdgeUnit`、`updateEdgeUnit`、`deleteEdgeUnit` | `POST /blueedge/edge-units`；`PUT/DELETE /blueedge/edge-units/:name` | `await` 后才提示成功；失败保留错误 | 已接入 |
| Home | 搜索、菜单、进入工作台 | B | 本地筛选/路由 | 无 | 不修改业务数据 | 纯前端合理 |
| Home | 监控组件下载、立即安装、通知 | D | 无 handler | 无 | 点击无反馈 | 空操作 |
| Dashboard | EdgeUnit 刷新 | A | EdgeUnit Context → `listEdgeUnits` | `GET /blueedge/edge-units` | 展示 Context 错误 | 已接入 |
| Dashboard | 编辑 EdgeUnit | A | `updateEdgeUnit` | `PUT /blueedge/edge-units/:name` | 请求完成后提示；失败展示错误 | 已接入 |
| Dashboard | EdgeUnit 切换、Tab、资源跳转 | B | Context/路由 | 无 | 基于真实 Context 数据 | 纯前端合理 |
| Dashboard | 通知 | D | 无 handler | 无 | 点击无反馈 | 空操作 |
| Nodes | 节点/指标/Pod/接入配置加载 | A | `listNodes`、`listNodeMetrics`、`listPods`、`listAccessConfigs` | `GET /bff/node`；`GET /metrics/nodes`；`GET /bff/pod`；`GET /blueedge/access-configs` | 辅助请求允许降级 | 已接入 |
| Nodes | 节点详情 | A | `getNodeSummary` | `GET /blueedge/nodes/:name/summary` | warnings 展示，不伪造指标 | 已接入 |
| Nodes | 保存别名、切换调度 | A | `getNode` → `updateNodeResource` | `GET /bff/node/:name`；`PUT /bff/node` | 更新成功后重新加载 | 已接入 |
| Nodes | 删除节点 | A | `deleteNodeResource` | `DELETE /bff/node/:name` | 失败不移除本地记录 | 已接入 |
| Nodes | 创建/修改/删除 AccessConfig | A* | `createAccessConfig`、`updateAccessConfig`、`deleteAccessConfig` | `POST /blueedge/access-configs`；`PUT/DELETE /blueedge/access-configs/:name` | 请求真实，但部分字段丢失 | 部分接入，P0 |
| Nodes | 搜索、分页、Tab、接入页跳转 | B | 本地筛选/路由 | 无 | 基于真实列表 | 纯前端合理 |
| Nodes | AccessConfig Tab 的刷新 | D | 始终执行 `loadNodes` | 只请求 Node 相关接口 | 不刷新 AccessConfig | 错误刷新，P1 |
| NodeGroups | 列表/详情/Summary | A | `listNodeGroups`、`getNodeGroup`、`getNodeGroupSummary` | `GET /bff/nodegroup`；`GET /bff/nodegroup/:name`；`GET /blueedge/nodegroups/:name/summary` | Summary warnings 降级 | 已接入 |
| NodeGroups | 创建/删除 | A | `createNodeGroupResource`、`deleteNodeGroupResource` | `POST /bff/nodegroup`；`DELETE /bff/nodegroup/:name` | 成功后重新加载 | 已接入 |
| NodeGroups | 搜索、分页、YAML、详情 Tab | B | 本地展示真实 raw | 无 | 不伪造资源 | 纯前端合理 |
| Deployments | 列表、搜索、分页、Namespace | A | `listDeploymentPage` | `GET /bff/deployment/:namespace?...` | 请求失败展示错误 | 已接入 |
| Deployments | 创建表单/YAML | A | `createDeploymentResource` | `POST /bff/deployment/:namespace` | `await` 后提示创建成功 | 已接入 |
| Deployments | 更新表单/YAML/标签注解 | A | `updateDeploymentResource` | `PUT /bff/deployment/:namespace` | 成功后 reload，再提示成功 | 已接入 |
| Deployments | 删除 | A | `deleteDeploymentResource` | `DELETE /bff/deployment/:namespace/:name` | 失败不假删除 | 已接入 |
| Deployments | Pod、Events、日志 | A | `listPods`、`getResourceObservability`、`getResourceLogs` | `GET /bff/pod/:namespace`；`GET /blueedge/observability/resources/...` | 辅助数据失败显示错误/warnings | 已接入 |
| Deployments | YAML 上传、下载、复制、详情 Tab | B | 本地解析/Blob/Clipboard | 无 | 数据来自真实 raw | 纯前端合理 |
| Deployments | 状态、停止、重启类入口 | C | `disabled`，标记“暂未开放” | 无 | 不提示假成功 | 已禁用 |
| Pods | 列表/指标/Namespace 切换 | A | `listPods`、`listPodMetrics` | `GET /bff/pod/:namespace`，失败时 `/workloads/pods`；`GET /metrics/pods` | 指标允许降级 | 已接入 |
| Pods | Summary、Events、日志 | A | `getPodSummary`、`getResourceLogs` | `GET /blueedge/pods/:namespace/:name/summary`；`GET /blueedge/observability/resources/pod/.../logs` | warnings/available 正常降级 | 已接入 |
| Pods | 删除 | A | `deletePodResource` | `DELETE /bff/pod/:namespace/:name` | 失败不移除列表 | 已接入 |
| Pods | 搜索、分页、Tab、复制 YAML | B | 本地处理真实数据 | 无 | 合理 | 纯前端合理 |
| EdgeApps | 列表、Summary、详情 | A | `listEdgeApplications`、`getEdgeAppSummary`、`getEdgeApplication` | `GET /bff/edgeapplication...`；`GET /blueedge/edgeapps/:ns/:name/summary` | 辅助数据 warnings 降级 | 已接入 |
| EdgeApps | 创建/编辑/删除 | A | `create/update/deleteEdgeApplicationResource` | `POST/PUT /bff/edgeapplication/:namespace`；`DELETE /.../:name` | 成功后重新加载 | 已接入 |
| EdgeApps | 暂停/恢复 | A | GET 后修改 `spec.paused` 再 PUT | `GET /bff/edgeapplication/:ns/:name`；`PUT /bff/edgeapplication/:ns` | 失败不改本地状态 | 已接入 |
| EdgeApps | 重启 | A | 修改 `blueedge.io/restartedAt` 后 PUT | `PUT /bff/edgeapplication/:namespace` | 失败展示错误 | 已接入 |
| EdgeApps | 日志 | A | `getResourceLogs` | `GET /blueedge/observability/resources/edgeapplication/.../logs` | 日志错误不影响主资源 | 已接入 |
| EdgeApps | YAML、Tab、搜索、分页 | B | 本地处理真实 raw | 无 | 合理 | 纯前端合理 |
| BatchTasks | 列表/详情/刷新 | A | `listBatchTasks`、`getBatchTask` | `GET /blueedge/batch-tasks`；`GET /blueedge/batch-tasks/:id` | 错误展示，列表不造假 | 已接入 |
| BatchTasks | 创建升级/预热计划 | A | `createNodeUpgradeTask`、`createImagePreheatTask` | `POST /blueedge/batch-tasks/upgrade`；`POST /image-preheat` | 请求成功后 reload | 已接入 planOnly |
| BatchTasks | 生成计划、取消、删除 | A | `startBatchTask`、`cancelBatchTask`、`deleteBatchTask` | `POST /:id/start`；`POST /:id/cancel`；`DELETE /:id` | `runAction` 先 await 后提示 | 已接入 planOnly |
| BatchTasks | 搜索、Tab、表单联动 | B | 本地处理 | 无 | 不宣称真实节点执行 | 纯前端合理 |
| BatchTasks | Events/Audit Tab | C | 明确显示尚未接真实执行事件 | 无 | 不展示静态假记录 | 未开放 |
| BatchWorkloads | 列表/刷新 | A | `listBatchTasks` 后筛选 `batchWorkload` | `GET /blueedge/batch-tasks` | 失败清空列表 | 已接入 |
| BatchWorkloads | YAML/镜像/部署计划创建 | A* | `createBatchWorkloadTask` | `POST /blueedge/workloads/batch` | 核心字段真实保存；高级字段有遗漏 | 部分接入 |
| BatchWorkloads | 删除 | A | `deleteBatchTask` | `DELETE /blueedge/batch-tasks/:id` | 成功后 reload | 已接入 |
| BatchWorkloads | YAML 下载、上传、查看、搜索 | B | 本地 Blob/解析 | 无 | 创建时 YAML 会进入真实 plan payload | 纯前端合理 |
| BatchWorkloads | 编辑 YAML | D | 只展示“不支持本地编辑假保存”错误 | 无 PUT 接口 | 不假成功，但入口仍可点 | 未实现，P1 |
| BatchWorkloads | Namespace 刷新 | D | 无 handler | 无 | 点击无效果 | 空操作，P1 |
| BatchWorkloads | 资源、环境变量、命令、GPU 等高级部署项 | D | 本地输入未进入 `onCreatePlan` payload | 无对应字段 | 用户输入静默丢失 | P0 |
| Rules | 列表、Namespace、详情 | A | `listRules`、`listNamespaces`、`getRule` | `GET /bff/rule...`；`GET /bff/namespace` | 失败展示错误 | 已接入 |
| Rules | 创建/编辑/删除 | A | `create/update/deleteRuleResource` | `POST/PUT /bff/rule/:namespace`；`DELETE /.../:name` | `await` 后才设置成功提示 | 已接入 |
| Rules | 搜索、菜单、表单联动、YAML | B | 本地处理真实资源 | 无 | 合理 | 纯前端合理 |
| Rules | 事件、审计、投递记录 | C | 明确空态 | 无 | 不展示静态记录 | 未开放 |
| RuleEndpoints | 列表、Namespace、详情 | A | `listRuleEndpoints`、`listNamespaces`、`getRuleEndpoint` | `GET /bff/ruleendpoint...`；`GET /bff/namespace` | 错误展示 | 已接入 |
| RuleEndpoints | 创建/删除 | A | `createRuleEndpointResource`、`deleteRuleEndpointResource` | `POST /bff/ruleendpoint/:namespace`；`DELETE /.../:name` | 成功后 reload | 已接入 |
| RuleEndpoints | 搜索、详情 Drawer、YAML 复制 | B | 本地展示真实 raw | 无 | 合理 | 纯前端合理 |
| ConfigMaps | 列表/Namespace | A | `listConfigMaps`、`listSecrets`、`listNamespaces` | `GET /bff/configmap...`；`GET /bff/secret...`；`GET /bff/namespace` | 请求失败展示错误 | 已接入 |
| ConfigMaps | 创建/编辑/YAML/删除 | A | ConfigMap/Secret CRUD service | `POST/PUT /bff/{configmap\|secret}/:namespace`；`DELETE /.../:name` | 成功后重新查询 | 已接入 |
| ConfigMaps | 导入、导出、复制、Tab、筛选 | B | 本地处理真实数据 | 无 | 合理 | 纯前端合理 |
| Secrets | 列表/详情 | A | `listSecrets`、`getSecret` | `GET /bff/secret...` | 错误展示 | 已接入 |
| Secrets | 创建/编辑/删除 | A | Secret CRUD service | `POST/PUT /bff/secret/:namespace`；`DELETE /.../:name` | 成功后 reload | 已接入 |
| Secrets | 搜索、分页、YAML 复制 | B | 本地处理真实 raw | 无 | 合理 | 纯前端合理 |
| DeviceModels | 列表/Summary/详情 | A | `listDeviceModelSummaries`、`getDeviceModelSummary` | `GET /blueedge/devicemodels/summary`；`GET /blueedge/devicemodels/:ns/:name/summary` | warnings 展示 | 已接入 |
| DeviceModels | 创建/删除 | A | `createDeviceModelResource`、`deleteDeviceModelResource` | `POST /bff/devicemodel/:namespace`；`DELETE /.../:name` | 创建失败仍关闭向导，P1 体验问题 | 已接入 |
| DeviceModels | Namespace 刷新、创建 Namespace | D | 无 handler | 无 | 点击无效果 | 空操作 |
| DeviceModels | 表单步骤、属性编辑、YAML | B | 本地组装真实创建 payload | 无额外接口 | 合理 | 纯前端合理 |
| DeviceInstances | 列表/Summary/详情/Events | A | `listDeviceSummaries`、`getDeviceSummary`、`getResourceObservability` | `GET /blueedge/devices/summary`；`GET /blueedge/devices/:ns/:name/summary`；`GET /blueedge/observability/...` | warnings 降级 | 已接入 |
| DeviceInstances | 创建/删除 | A* | `createDeviceResource`、`deleteDeviceResource` | `POST /bff/device/:namespace`；`DELETE /.../:name` | 创建请求真实，但 YAML 字段被忽略 | 部分接入，P0 |
| DeviceInstances | 上传、下载、复制 YAML | B | 当前 raw/本地 Blob | 无 | 合理 | 纯前端合理 |
| AccessNodePage | 列表/刷新/安装命令 | A | `listAccessConfigs`、`getAccessConfigInstallCommand` | `GET /blueedge/access-configs`；`GET /:name/install-command` | 显示 `ready=false` 和缺失项 | 已接入模板 |
| AccessNodePage | 复制命令、步骤切换 | B | Clipboard/本地状态 | 无 | 不宣称安装成功 | 纯前端合理 |
| AccessNodePage | 下载接入文件 | C | `disabled`，“下载暂未配置” | service 存在但 UI 不调用 | 不会假下载 | 已禁用 |
| PV | 列表/Summary/详情 | A | PV summary service | `GET /blueedge/storage/persistentvolumes/summary`；`GET /.../:name/summary` | warnings 展示 | 已接入 |
| PV | 创建/删除 | A | storage service | `POST /storage/persistentvolumes`；`DELETE /storage/persistentvolumes/:name` | 成功后 reload | 已接入 |
| PVC | 列表/Summary/详情 | A | PVC summary service | `GET /blueedge/storage/persistentvolumeclaims/summary`；`GET /.../:ns/:name/summary` | warnings 展示 | 已接入 |
| PVC | 创建/删除 | A | storage service | `POST /storage/persistentvolumeclaims`；`DELETE /storage/persistentvolumeclaims/:ns/:name` | 成功后 reload | 已接入 |
| Services | 列表/详情/CRUD | A | Service CRUD service | `GET /bff/service...`；`POST/PUT /bff/service/:ns`；`DELETE /.../:name` | 失败展示错误 | 已接入 |
| Roles | 列表/创建/编辑/删除 | A | Role CRUD service | `GET /bff/role...`；`POST/PUT /bff/role/:ns`；`DELETE /.../:name` | 成功后 reload | 已接入 |
| RoleBindings | 列表/创建/编辑/删除 | A | RoleBinding CRUD | `/product-api/bff/rolebinding...` | 成功后 reload | 已接入 |
| ClusterRoles | 列表/创建/编辑/删除 | A | ClusterRole CRUD | `/product-api/bff/clusterrole...` | 成功后 reload | 已接入 |
| ClusterRoleBindings | 列表/创建/编辑/删除 | A | ClusterRoleBinding CRUD | `/product-api/bff/clusterrolebinding...` | 成功后 reload | 已接入 |
| ServiceAccounts | 列表/创建/编辑/删除 | A | ServiceAccount CRUD | `/product-api/bff/serviceaccount...` | 成功后 reload | 已接入 |
| CRD | 列表/详情 | A | `listCRDs`、`getCRD` | `GET /bff/crd`；`GET /bff/crd/:name` | 错误展示 | 已接入 |
| RBAC/CRD | 搜索、分页、详情、YAML 复制 | B | 本地处理真实 raw | 无 | 合理 | 纯前端合理 |

## 四、P0 阻塞项

### 4.1 AccessConfig 创建字段被静默丢弃

表单包含：

- `driver`
- `criAddress`

但构造 `AccessConfigPayload` 时均未写入 payload。

- 表单字段：`frontend/src/pages/Nodes.tsx:778`
- CRI 字段：`frontend/src/pages/Nodes.tsx:785`
- 实际 payload：`frontend/src/pages/Nodes.tsx:405`

风险：

- 用户选择驱动方式和 CRI 地址后，接口请求会成功。
- 页面可能表现为“创建成功”，但这两个值不会持久化。
- 属于**部分假写入**。

### 4.2 Device 创建 YAML 配置未进入资源

`accessYaml` 和每个 Twin 的 `yaml` 可编辑，但 `buildDeviceResource` 只写入：

- Twin 名称
- expected
- collectCycle
- reportCycle

没有写入 YAML 内容。

- 资源构造：`frontend/src/pages/DeviceInstances.tsx:96`
- 创建调用：`frontend/src/pages/DeviceInstances.tsx:235`
- YAML 编辑入口：`frontend/src/pages/DeviceInstances.tsx:376`

风险：

- 用户认为接入配置、采集地址、Topic 等会写入 Device。
- 实际创建的 K8S Device 不包含这些配置。
- 属于**部分假写入**。

### 4.3 BatchWorkloads 高级部署配置未进入计划

最终 `onCreatePlan` 只提交：

- `targetGroups`
- `replicas`
- `containers.name`
- `containers.image`

以下 UI 不进入 payload：

- CPU/内存请求和限制
- GPU
- 环境变量
- 命令和参数
- 新增镜像规则
- 模块确认按钮
- 多个删除按钮

- 实际提交：`frontend/src/pages/BatchWorkloads.tsx:1407`
- 资源配置 UI：`frontend/src/pages/BatchWorkloads.tsx:1563`
- 环境变量 UI：`frontend/src/pages/BatchWorkloads.tsx:1593`
- 命令参数 UI：`frontend/src/pages/BatchWorkloads.tsx:1606`
- 无 handler 的确认：`frontend/src/pages/BatchWorkloads.tsx:1709`

风险：

- 虽然真实创建了 planOnly BatchTask，但用户输入的高级配置静默丢失。
- 不能宣称该部署计划完整反映页面配置。

## 五、P1 问题

1. Nodes 在 AccessConfig Tab 点击刷新仍执行 `loadNodes`，不刷新 AccessConfig。  
   `frontend/src/pages/Nodes.tsx:573`

2. BatchWorkloads 编辑 YAML 入口仍可点击，但提交只显示“不支持本地编辑假保存”。  
   `frontend/src/pages/BatchWorkloads.tsx:440`

3. BatchWorkloads 创建页 Namespace 刷新按钮无 handler。  
   `frontend/src/pages/BatchWorkloads.tsx:746`

4. DeviceModels Namespace 刷新和“创建命名空间”均无 handler。  
   `frontend/src/pages/DeviceModels.tsx:293`

5. Home 的“边缘监控组件”下载和“立即安装”无 handler。  
   `frontend/src/pages/Home.tsx:889`

6. DeviceModels、DeviceInstances 创建失败后仍在 `finally` 中关闭创建向导，用户填写内容会丢失。  
   `frontend/src/pages/DeviceModels.tsx:207`  
   `frontend/src/pages/DeviceInstances.tsx:235`

## 六、P2 问题

- Header 通知按钮无 handler：`frontend/src/components/layout/Header.tsx:98`
- Header 个人设置无 handler：`frontend/src/components/layout/Header.tsx:113`
- Home 通知按钮无 handler：`frontend/src/pages/Home.tsx:1015`
- Dashboard 通知按钮无 handler：`frontend/src/pages/Dashboard.tsx:221`
- `ResourceList` 内的刷新、YAML、删除均无 handler，但该组件当前没有被页面引用，属于死代码，不进入生产交互流：`frontend/src/components/common/ResourceList.tsx:70`

## 七、成功提示审计

检查到的业务成功提示均在真实请求成功之后执行：

- Deployment 创建、更新、删除：先 `await`，再 `showToast`。  
  `frontend/src/pages/Deployments.tsx:647`
- Rules 创建、更新、删除：先 `await`，再 `setNotice`。  
  `frontend/src/pages/Rules.tsx:350`
- Home EdgeUnit CRUD：先 `await`，再成功提示。  
  `frontend/src/pages/Home.tsx:961`
- Dashboard 更新：先 `await updateEdgeUnit`，再提示。  
  `frontend/src/pages/Dashboard.tsx:616`
- BatchTasks：`runAction` 先等待 start/cancel，再显示消息。  
  `frontend/src/pages/BatchTasks.tsx:1203`

结论：

- **只提示成功但没有请求：0**
- **请求未 await 就提示成功：0**
- **catch 后仍执行成功提示：0**

## 八、数量汇总

采用去重后的用户功能入口口径：

| 分类 | 数量 |
|---|---:|
| 可感知功能入口总数 | **203** |
| A 已接真实接口 | **125** |
| B 合理纯前端交互 | **60** |
| C 已禁用/明确未开放 | **4** |
| D 假操作、空操作或部分写入 | **14** |
| E 无法确认 | **0** |
| 原始事件绑定数 | **1064** |
| 写操作/命令意图总数 | **79** |
| 完整接入后端写操作 | **73** |
| 未接或部分接入写操作 | **6** |
| 刷新能力总数 | **35** |
| 正确请求当前数据的刷新 | **32** |

接入率：

```text
125 / (125 + 4 + 14) = 87.4%
```

纯前端合理交互未计入分母。

## 九、最终验收判断

### 9.1 是否所有需要后端的点击功能都已接入？

否，存在部分字段未持久化、空按钮和错误刷新。

### 9.2 是否仍存在可点击假写操作？

是，主要是 AccessConfig 字段、Device YAML、BatchWorkloads 高级配置。

### 9.3 是否存在只提示成功但未请求？

未发现。

### 9.4 是否存在可点击但 handler 为空？

是，包括通知、个人设置、监控组件、Namespace 刷新/创建、高级部署配置等。

### 9.5 是否存在没有后端能力却保持可点击？

是，BatchWorkloads YAML 编辑、Home 监控安装、部分 Namespace 操作仍可点击。

### 9.6 哪些属于合理纯前端行为？

- 搜索
- 已加载数据分页
- Tab 切换
- 弹窗开关
- 路由跳转
- 复制文本
- 展示 raw/YAML
- 从真实数据生成 Blob 下载
- 退出时清除本地 Token

### 9.7 是否建议宣称 V1.2.0 所有交互能力已真实化？

**不建议。**

应先处理 3 项 P0。处理后可以宣称：

> 核心资源 CRUD、Summary、Observability 和 planOnly 计划能力已真实接入。

但仍不能宣称 BatchTask/BatchWorkload 会真实执行：

- 节点升级
- 镜像预热
- Kubernetes Deployment 下发

## 十、建议修复顺序

1. 修复 AccessConfig `driver`、`criAddress` 字段丢失问题。
2. 明确 Device 接入 YAML/Twin YAML 的真实数据模型；无法持久化时先禁用编辑。
3. BatchWorkloads 高级部署项接入 plan payload，或整体标记为未开放并禁用。
4. 修复三个错误或空刷新入口。
5. 禁用 BatchWorkloads YAML 编辑、Home 监控安装等无后端能力入口。
6. 最后清理通知、个人设置和未引用 `ResourceList` 等 P2 项。
