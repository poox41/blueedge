# BlueEdge V1.2.0 原型迁移复盘与线上发版交接总结

> 用途：个人复盘、团队同步、后续开发者接手  
> 工作时间：2026-07-15 至 2026-07-16 凌晨  
> 最终提交：`330ed71 feat(platform): align v1.2.0 prototype experience`  
> 工作分支：`feat/blueedge-v1.2.0-integration`  
> 线上入口：`http://14.103.163.121:30080/`

## 1. 一句话结论

本轮不是单纯换皮，而是在保留现有 React + TypeScript 前端、API Gateway 和真实 Kubernetes/KubeEdge 接口链路的基础上，按 BlueEdge V1.2.0 原型统一重做了主要页面的视觉规范、列表和详情交互、弹窗尺寸、操作菜单、面包屑导航与表单流程，同时补齐了接入配置、批量任务重试、批量工作负载高级资源配置等必要接口能力；代码已经提交，前端和 API Gateway 新镜像已经推送并滚动更新到线上，内外网验收均返回 HTTP 200。

## 2. 本轮目标与实施原则

### 2.1 用户目标

- 前端页面尽量还原桌面原型的布局、字号、颜色、边框、按钮和弹窗。
- 列表、详情、操作菜单和编辑流程与原型的交互方式保持一致。
- 已经存在的真实后端接口继续使用，不能为了还原原型退回静态 Mock。
- 补齐原型新增交互所需的少量 API Gateway 能力。
- 完成代码提交、镜像构建、镜像推送和服务器线上替换。

### 2.2 实施原则

1. 保留当前 React 技术栈，没有将项目整体改成 Vue。
2. 复用原型的视觉结构，但数据来源仍以真实 BFF、API Gateway、Kubernetes 和 KubeEdge 资源为准。
3. 列表整行可进入详情，操作按钮和三点菜单阻止事件冒泡。
4. 高风险删除统一使用二次确认，资源名确认场景要求输入名称。
5. 页面样式与真实接口分开判断：样式完成不代表接口已真实接入。
6. 线上只替换有代码变化的镜像，本轮 BFF 未变化，因此没有重新构建和替换 BFF。

## 3. 代码变更总览

最终提交共修改 28 个文件：

```text
3520 insertions(+)
2012 deletions(-)
```

其中：

- 前端页面、路由、布局和全局样式：20 个文件。
- 前端 API 适配：2 个文件。
- API Gateway：6 个文件。
- 新增页面：`frontend/src/pages/AccessConfigDetailPage.tsx`。

完整文件清单：

```text
frontend/src/App.tsx
frontend/src/api/adapters/edge-unit.adapter.ts
frontend/src/api/services/product.ts
frontend/src/components/layout/Header.tsx
frontend/src/components/layout/Sidebar.tsx
frontend/src/components/ui/alert-dialog.tsx
frontend/src/index.css
frontend/src/pages/AccessConfigDetailPage.tsx
frontend/src/pages/AccessNodePage.tsx
frontend/src/pages/BatchTasks.tsx
frontend/src/pages/BatchWorkloads.tsx
frontend/src/pages/ConfigMaps.tsx
frontend/src/pages/Dashboard.tsx
frontend/src/pages/Deployments.tsx
frontend/src/pages/DeviceInstances.tsx
frontend/src/pages/DeviceModels.tsx
frontend/src/pages/Home.tsx
frontend/src/pages/LoginPage.tsx
frontend/src/pages/NodeGroups.tsx
frontend/src/pages/Nodes.tsx
frontend/src/pages/RuleEndpoints.tsx
frontend/src/pages/Rules.tsx
server/api-gateway/src/clients/bff-client.ts
server/api-gateway/src/routes/access-config.routes.ts
server/api-gateway/src/services/access-config.service.ts
server/api-gateway/src/services/batch-task.service.ts
server/api-gateway/src/services/batch-workload.service.ts
server/api-gateway/src/types/batch-task.ts
```

本轮没有修改：

- `server/bff` 业务代码。
- 数据库结构。
- Kubernetes CRD 定义。
- 线上 BFF 镜像。

## 4. 详细改动复盘

### 4.1 全局视觉规范和布局

涉及文件：

- `frontend/src/index.css`
- `frontend/src/components/layout/Header.tsx`
- `frontend/src/components/layout/Sidebar.tsx`
- `frontend/src/components/ui/alert-dialog.tsx`
- `frontend/src/App.tsx`

主要改动：

- 统一页面背景、卡片圆角、边框颜色、阴影、正文颜色和次要文字颜色。
- 统一主按钮、次按钮、危险按钮、图标按钮、Tab 和表格操作按钮的高度与圆角。
- 统一搜索框、输入框、Select、Textarea 的字号和聚焦态。
- 调整顶部导航栏的边缘单元、命名空间和页面层级显示。
- 调整左侧菜单激活态、分组标题、底部边缘单元状态卡和折叠区域。
- 新增详情页路由：节点组、批量任务、设备模型、终端设备和接入配置均可以通过 URL 直接进入。
- 删除确认弹窗整体收窄，避免之前弹窗过大。

新增或调整的详情路由：

```text
/nodes/access-config/:name
/nodegroups/:name
/batchtasks/:taskId/:taskName
/devicemodels/:namespace/:name
/deviceinstances/:namespace/:name
/ruleendpoints/:namespace/:name
```

### 4.2 登录页面

涉及文件：`frontend/src/pages/LoginPage.tsx`

主要改动：

- 按原型重构为左右两栏布局。
- 左侧增加 BlueEdge 品牌、产品说明、能力标签和背景装饰。
- 右侧登录卡统一宽度、间距、阴影、输入框和按钮规格。
- 增加用户名记忆功能，使用 `blueedge_remembered_account` 保存账号，不保存密码。
- 增加密码显隐交互。
- 忘记密码点击后明确提示联系管理员，不伪造自助找回流程。
- 登录仍调用真实 `POST /product-api/auth/login`，没有改成前端模拟。

### 4.3 边缘单元列表、概览和创建/编辑

涉及文件：

- `frontend/src/pages/Home.tsx`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/api/adapters/edge-unit.adapter.ts`

主要改动：

- 边缘单元列表卡片、指标区、基本信息区和操作菜单按原型重新排版。
- 概览页增加介绍卡、快速入门、资源统计和基本信息/高级设置 Tab。
- 创建边缘单元改为三步向导：选择类型、基本信息、高级设置。
- 创建框、类型卡片、步骤条、按钮尺寸和底部固定操作区按原型调整。
- 编辑边缘单元改为两步：基本信息、高级设置。
- 基本信息包括类型、集群、版本、节点规模、MQTT、Insight、Monitor 和描述。
- 高级设置包括云端访问地址、通信协议、端口设置和卸载策略。
- 补齐原型中的默认端口：

```text
WebSocket   30000
QUIC        30001
HTTPS       30002
CloudStream 30003
Tunnel      30004
```

- 通信相关字段发生修改时会显示风险提示，关闭未保存编辑会二次确认。
- 真实创建、编辑和删除仍调用 EdgeUnit API；NodeGroup 保持独立管理，不因删除边缘单元自动删除。

### 4.4 边缘节点与接入配置

涉及文件：

- `frontend/src/pages/Nodes.tsx`
- `frontend/src/pages/AccessNodePage.tsx`
- `frontend/src/pages/AccessConfigDetailPage.tsx`
- `frontend/src/api/services/product.ts`
- `server/api-gateway/src/routes/access-config.routes.ts`
- `server/api-gateway/src/services/access-config.service.ts`

边缘节点列表：

- 按原型收敛列表字段，不再把 IP 地址、创建时间等非原型重点字段塞进主列表。
- Tab、搜索框、接入节点按钮和表格尺寸重新对齐。
- 节点列表支持整行进入详情，不再只能点击节点名称。
- 操作菜单使用独立浮层，避免被表格容器裁切。

接入配置：

- 接入配置列表整行可进入新的详情页。
- 新增接入配置详情页，包含指标卡、基本信息、接入节点、标签和 YAML Tab。
- 标签和 YAML 区域按原型改为卡片式展示，并支持复制。
- 编辑接入配置弹窗调整为原型尺寸和表单结构。
- 关闭编辑时增加“确认取消编辑”弹窗，避免误丢数据。
- 接入节点页面不再强制提供默认节点名称；节点名可以留空，也可以由用户明确输入。
- 安装命令接口增加可选 `nodeName` 查询参数。节点名为空时，不再生成 `--edgenode-name` 参数。
- API Gateway 对用户传入的节点名执行 Kubernetes 资源名称校验。
- AccessConfig 创建 payload 已包含 `driver` 和 `criAddress`，修复旧审计报告中这两个字段被静默丢弃的问题。

### 4.5 边缘节点组

涉及文件：`frontend/src/pages/NodeGroups.tsx`

主要改动：

- 列表、搜索框、刷新按钮、创建按钮和表格规格按原型重新对齐。
- 删除节点组弹窗改为紧凑危险确认框。
- 删除前必须输入节点组名称，并提供复制名称按钮。
- 列表整行可进入详情。
- 详情页顶部面包屑增加节点组名称。
- 详情页重做基本信息、标签选择器、描述和成员节点列表。
- 编辑弹窗重做标签匹配、指定节点、已选节点和底部操作区。
- 编辑弹窗尺寸和内部滚动行为按原型收敛。

### 4.6 设备模型

涉及文件：`frontend/src/pages/DeviceModels.tsx`

主要改动：

- 列表字号、按钮、表格、协议状态标签和删除按钮按原型统一。
- 支持整行进入详情，名称仍保留链接视觉，但不再是唯一入口。
- 详情路由写入命名空间和设备模型名称，顶部导航可显示当前资源名。
- 详情页重做基本信息、孪生属性、标签和 YAML 展示。
- 创建/编辑向导的步骤条、弹窗宽度、字段间距和底部按钮按原型调整。
- 取消编辑确认框收窄，避免之前遮挡范围过大。
- 孪生属性编辑、增加和配置入口重新组织。

### 4.7 终端设备

涉及文件：`frontend/src/pages/DeviceInstances.tsx`

主要改动：

- 列表支持整行进入详情。
- 详情面包屑增加设备名称。
- 详情页重新组织基本信息、孪生数据、标签、访问配置、事件和审计 Tab。
- 孪生数据表格、期望值输入、上报值、同步时间和操作按钮按原型调整。
- 标签区域改为卡片式展示，支持新增和删除真实标签。
- 访问配置改为 YAML 预览卡，支持复制。
- 编辑设备向导统一为四步视觉结构，弹窗尺寸、步骤条和表单字号按原型收敛。
- 设备创建和编辑 payload 现在会提交 `accessConfigYaml` 和完整 `properties`。
- 每个孪生属性携带期望值、采集周期、上报周期和访问配置 YAML。
- 修复旧审计报告中终端设备 YAML/孪生配置只停留在前端、未进入资源 payload 的问题。

### 4.8 批量任务

涉及文件：

- `frontend/src/pages/BatchTasks.tsx`
- `server/api-gateway/src/services/batch-task.service.ts`
- `server/api-gateway/src/types/batch-task.ts`

主要改动：

- 首页节点升级/镜像预热 Tab、搜索框、创建按钮、状态标签和表格按钮按原型调整。
- 列表支持整行进入任务详情。
- 任务详情面包屑增加任务名称。
- 详情页基本信息、任务详情、执行进度、事件和审计 Tab 重新布局。
- 执行概览改为目标节点、成功、失败、跳过和进度条组合。
- 执行步骤按原型改为阶段卡片。
- 事件列表改为时间、类型、原因和消息四列。
- 失败重试、回滚任务和更多按钮按原型统一尺寸和状态。
- 重试成功后使用顶部轻提示反馈，不再把成功操作表现成橙色错误横幅。

后端补强：

- `NodeUpgradeJob` 失败重试不再尝试修改原资源。
- API Gateway 会复制原任务的 `spec`、labels 和 annotations，创建一个新任务。
- 新任务名格式：`原任务名-retry-YYYYMMDD-HHmmss`。
- 新任务增加 `blueedge.io/retry-of` 和 `blueedge.io/retry-count` 注解。
- `ImagePrePullJob` 仍遵循 KubeEdge 自己的 retryTimes，不支持手工重复创建同名资源。

### 4.9 工作负载

涉及文件：`frontend/src/pages/Deployments.tsx`

主要改动：

- 列表搜索、创建按钮、表格密度和操作列按原型调整。
- 每行查看、回退和三点菜单按钮重新对齐。
- 三点菜单支持控制台、监控、日志、编辑 YAML、更新、回退、状态、标签注解和删除等入口。
- 菜单使用 Portal/固定定位，避免被表格或页面底部裁切。
- 详情页基本信息、容器组列表、事件、审计和 YAML 区域重新排版。
- 控制台弹窗按原型重做 Pod、容器选择和命令输入区。
- 删除工作负载要求输入名称确认。
- 原有真实 Deployment CRUD、日志、事件和 Pod 数据链路保留。

### 4.10 批量工作负载

涉及文件：

- `frontend/src/pages/BatchWorkloads.tsx`
- `frontend/src/api/services/product.ts`
- `server/api-gateway/src/services/batch-workload.service.ts`
- `server/api-gateway/src/types/batch-task.ts`

列表和详情：

- 列表按钮、表格密度、三点操作菜单和菜单定位按原型调整。
- 操作菜单不再溢出表格和浏览器可视区域。
- 支持查看定义、编辑 YAML、新增部署和删除。
- 详情页重做定义、部署记录和差异化配置区域。
- “新增部署”弹窗按原型调整宽度、标题、提示卡、节点组表格、实例数、容器 Tab 和底部按钮。

创建向导：

- 调整三步创建向导、步骤条、弹窗尺寸、滚动区域和固定底部按钮。
- 输入框默认值改为 placeholder 灰色显示，不再把示例值当作黑色真实值。
- 增加“启用 GPU”复选框。
- 启用 GPU 后显示 GPU 类型和数量；默认资源键为 `nvidia.com/gpu`。
- 支持 CPU/内存 requests 和 limits、GPU、环境变量、生命周期、健康检查、安全上下文、卷挂载、端口和发布策略。
- 上述高级配置现在会进入 `BatchWorkloadPlan` payload，不再只是前端展示。
- resources 类型由固定 CPU/内存字段改为 `Record<string, string>`，允许 `nvidia.com/gpu` 等扩展资源。
- 创建定义时允许暂不选择 NodeGroup；后续新增真实部署时再选择目标组。

### 4.11 配置项与密钥

涉及文件：`frontend/src/pages/ConfigMaps.tsx`

主要改动：

- 配置项/密钥切换、搜索、刷新、YAML 创建和创建按钮按原型统一。
- 表格操作列宽度和三点按钮位置重新对齐。
- 操作菜单改为 Portal，避免在表格内溢出或被裁切。
- 配置项和密钥分别提供编辑 YAML、更新、导出和删除等操作。
- Secret 数据支持遮罩、Base64 判断和解码展示。
- 创建、表单更新、YAML 更新和删除均增加独立确认流程。
- 保留真实 ConfigMap/Secret CRUD，不使用本地伪保存。

### 4.12 消息端点与消息路由

涉及文件：

- `frontend/src/pages/RuleEndpoints.tsx`
- `frontend/src/pages/Rules.tsx`

消息端点：

- 列表、创建按钮、刷新、搜索和操作列按原型统一。
- 列表整行可进入详情。
- 详情页重做基本信息、连接状态、事件和审计。
- 编辑弹窗和删除确认弹窗按原型调整。
- 三点菜单位置统一，点击操作按钮不会触发整行跳转。

消息路由：

- 操作列和三点按钮重新对齐。
- 路由名称和命名空间在编辑状态下均可编辑，不再错误禁用。
- 列表整行进入详情，详情包含投递记录、事件和审计 Tab。
- 创建/编辑路由弹窗、端点选择卡、帮助提示和 YAML 预览按原型重做。
- 删除要求输入路由名称确认。
- 保留真实 Rule/RuleEndpoint CRUD 和观测接口。

### 4.13 API Gateway 错误边界

涉及文件：`server/api-gateway/src/clients/bff-client.ts`

主要改动：

- 上游 BFF 返回 401 时，不再原样向前端冒充当前用户登录失败。
- API Gateway 改为返回 502，并提示“上游 BFF 鉴权失败，请检查服务器访问凭证”。
- 这样可以区分平台登录 Token 问题和 Gateway 到 BFF 的服务器凭据问题。

## 5. 真实接口与前端样式的边界

本轮必须明确区分以下三类变化：

| 类型 | 说明 | 典型模块 |
|---|---|---|
| 样式和交互调整 | 改布局、字号、按钮、弹窗、整行跳转和菜单定位，不改变接口语义 | 登录、列表、详情、操作菜单 |
| 前端 payload 修正 | UI 字段以前没有进入请求，本轮补入真实 payload | AccessConfig、Device、BatchWorkload GPU/高级配置 |
| API Gateway 能力补强 | 为原型交互新增或修正后端行为 | 自定义接入节点名、NodeUpgradeJob 重试、BFF 401 错误边界 |

需要特别注意：

- `BlueEdge-V1.2.0前端可点击功能与后端接口映射审计报告.md` 的审计日期是 2026-07-14。
- 最终提交发生在 2026-07-16 02:06。
- 旧报告中的 AccessConfig 字段丢失、Device YAML 丢失、BatchWorkload 高级配置丢失等结论，已被本轮代码部分或全部修复。
- 旧报告不能继续作为最终接入率结论，后续应基于 `330ed71` 重新跑一次完整按钮和接口审计。

## 6. 构建、测试、提交和发版结果

### 6.1 本地验证

执行并通过：

```bash
cd frontend
npm run build

cd ../server/api-gateway
npm test

cd ../..
git diff --check
```

结果：

- 前端 Vite 构建成功。
- API Gateway 测试 16/16 通过。
- `git diff --check` 通过。
- 前端仍有常规大 chunk 提示，不影响构建产物。
- API Gateway `npm ci` 审计提示 1 个 high severity vulnerability，尚未在本轮升级依赖，需单独评估。

### 6.2 Git 提交

```text
330ed71 feat(platform): align v1.2.0 prototype experience
```

发版完成后工作区为 clean。

### 6.3 镜像

本轮只构建有变化的两个组件，平台为 `linux/amd64`：

```text
183.95.195.121:31438/blueedge/frontend:2026071601
digest: sha256:db25ccce2b59f683bd352b0e29b6117d8aa03a4eeb9e8ea07957bf2120ec3dfe

183.95.195.121:31438/blueedge/api-gateway:2026071601
digest: sha256:49127ebace1109e3fb71c81f052d400fea25f01ab71c148b0646f9f3562d0dbe
```

BFF 无代码变化，继续使用：

```text
183.95.195.121:31438/blueedge/bff:2026062201
```

### 6.4 线上滚动更新

目标服务器：

```text
root@14.103.163.121
namespace: blueedge
```

实际更新：

```bash
kubectl set image deployment/blueedge-api-gateway \
  blueedge-api-gateway=183.95.195.121:31438/blueedge/api-gateway:2026071601 \
  -n blueedge

kubectl rollout status deployment/blueedge-api-gateway -n blueedge --timeout=180s

kubectl set image deployment/blueedge-frontend \
  blueedge-frontend=183.95.195.121:31438/blueedge/frontend:2026071601 \
  -n blueedge

kubectl rollout status deployment/blueedge-frontend -n blueedge --timeout=180s
```

最终状态：

```text
blueedge-api-gateway  Ready 1/1  2026071601
blueedge-frontend     Ready 1/1  2026071601
blueedge-bff          Ready 1/1  2026062201
```

Pod 的 `imageID` 与推送 digest 完全一致。

### 6.5 线上验收

服务器内部：

```text
GET http://127.0.0.1:30080/product-api/healthz -> 200
GET http://127.0.0.1:30080/                    -> 200
```

操作机公网验证：

```text
GET http://14.103.163.121:30080/product-api/healthz -> 200
GET http://14.103.163.121:30080/                    -> 200
```

新 Pod 日志中未发现 `error`、`exception`、`fatal` 或 `panic`。

## 7. 当前遗留事项和风险

### 7.1 必须优先关注

1. **重新做全量按钮/接口审计**  
   旧审计报告基于 2026-07-14 的代码，已经不能代表最终提交状态。

2. **建立视觉回归基线**  
   本轮经过大量人工截图比对，但没有自动化像素差异测试。不能仅凭代码提交宣称所有分辨率都已经 100% 像素级一致。

3. **把线上镜像版本持久化到部署清单**  
   本轮使用 `kubectl set image` 更新了线上 Deployment，但不会自动改写仓库里的 Kubernetes YAML。后续如果直接应用旧 YAML，可能把镜像回退。

4. **服务器密码安全**  
   本轮发版过程中密码通过对话临时提供。建议更换密码，并配置 SSH Key，避免后续继续使用明文密码。

### 7.2 技术债务

- 前端产物存在大 chunk 警告，可后续按页面拆包和懒加载。
- API Gateway 依赖审计存在 1 个 high severity 告警，需要先评估兼容性再升级。
- 应补充详情路由、菜单 Portal、表单取消确认、GPU payload 和任务重试的自动化测试。
- 需要确认原型目标视口，至少覆盖 1920×1080、1440×900 和 1024×600。
- 需要在真实数据量较大时复测长名称截断、表格横向空间、菜单贴边定位和弹窗滚动。

## 8. 下一位同事接手建议

### 8.1 首先确认代码和运行环境

```bash
git switch feat/blueedge-v1.2.0-integration
git pull
git log -1 --oneline
git status --short
```

预期 HEAD：

```text
330ed71 feat(platform): align v1.2.0 prototype experience
```

### 8.2 本地启动和验证

建议按项目已有脚本启动，不要只启动前端后误判接口异常：

```bash
bash scripts/run-dev-stack.sh
```

然后验证：

```bash
cd frontend && npm run build
cd ../server/api-gateway && npm test
```

### 8.3 推荐复测顺序

1. 登录页面。
2. 边缘单元列表、概览、创建和编辑两步/三步向导。
3. 边缘节点与接入配置详情、编辑和获取接入命令。
4. 节点组列表、详情、编辑和输入名称删除。
5. 设备模型与终端设备的整行跳转、面包屑、编辑和孪生数据。
6. 批量任务的失败重试、回滚、执行进度和事件。
7. 工作负载三点菜单、控制台和删除确认。
8. 批量工作负载 GPU、高级配置 payload 和新增部署。
9. 配置项与密钥三点菜单、编辑 YAML、更新和删除。
10. 消息端点、消息路由列表操作和编辑流程。

### 8.4 重点接口回归

```text
POST /product-api/auth/login
GET/POST/PUT/DELETE /product-api/blueedge/access-configs
GET /product-api/blueedge/access-configs/:name/install-command?nodeName=
POST /product-api/blueedge/batch-tasks/:id/retry
POST /product-api/blueedge/workloads/batch
GET/POST/PUT/DELETE /product-api/bff/nodegroup
GET/POST/PUT/DELETE /product-api/bff/device
GET/POST/PUT/DELETE /product-api/bff/devicemodel
GET/POST/PUT/DELETE /product-api/bff/configmap
GET/POST/PUT/DELETE /product-api/bff/secret
GET/POST/PUT/DELETE /product-api/bff/rule
GET/POST/PUT/DELETE /product-api/bff/ruleendpoint
```

### 8.5 检查线上版本

```bash
kubectl get deployment -n blueedge \
  -o 'custom-columns=NAME:.metadata.name,READY:.status.readyReplicas,IMAGE:.spec.template.spec.containers[*].image'

curl -fsS http://127.0.0.1:30080/product-api/healthz
curl -I http://127.0.0.1:30080/
```

## 9. 回滚方案

如新版本出现阻断问题，先回滚到上一版镜像：

```bash
kubectl set image deployment/blueedge-api-gateway \
  blueedge-api-gateway=183.95.195.121:31438/blueedge/api-gateway:2026071501 \
  -n blueedge

kubectl rollout status deployment/blueedge-api-gateway -n blueedge --timeout=180s

kubectl set image deployment/blueedge-frontend \
  blueedge-frontend=183.95.195.121:31438/blueedge/frontend:2026071501 \
  -n blueedge

kubectl rollout status deployment/blueedge-frontend -n blueedge --timeout=180s
```

也可以查看 Deployment 历史后执行：

```bash
kubectl rollout history deployment/blueedge-api-gateway -n blueedge
kubectl rollout history deployment/blueedge-frontend -n blueedge
kubectl rollout undo deployment/blueedge-api-gateway -n blueedge
kubectl rollout undo deployment/blueedge-frontend -n blueedge
```

## 10. 可以直接发给 Leader / 同事的话

> BlueEdge V1.2.0 这一轮主要完成了前端原型迁移和交互统一，覆盖登录、边缘单元概览、边缘节点、接入配置、节点组、设备模型、终端设备、批量任务、工作负载、批量工作负载、配置项与密钥、消息端点和消息路由。除了字号、按钮、卡片、弹窗、面包屑、整行跳转和三点菜单等视觉交互调整，也补了 AccessConfig 自定义节点名、NodeUpgradeJob 真实重试、终端设备 YAML/孪生配置 payload、批量工作负载 GPU 和高级资源配置等接口能力。代码已提交为 `330ed71`，前端和 API Gateway 已发布 `2026071601` 镜像 