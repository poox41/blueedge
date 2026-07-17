# BlueEdge V1.2.0 开发测试报告

## 1. 报告信息

| 项目 | 内容 |
| --- | --- |
| 项目名称 | BlueEdge 边缘计算管理平台 |
| 测试版本 | V1.2.0 开发分支版本 |
| 当前分支 | `feat/blueedge-v1.2.0-integration` |
| 当前代码基线 | `55fc935 feat(platform): unify resource pagination and edge workload ownership` |
| 独立测试镜像 | Frontend / API Gateway `20260717-head-55fc935` |
| 独立测试环境 | Kubernetes 命名空间 `blueedge-test`，NodePort `30081` |
| 当前线上观察基线 | Frontend / API Gateway 镜像标签 `2026071703`；本轮未改动 |
| 测试日期 | 2026-07-17 |
| 测试类型 | 开发自测、构建验证、单元测试、只读接口冒烟、发布健康检查 |
| 执行角色 | 开发自测 / Codex |
| 报告结论 | 开发自测通过，具备提测条件；浏览器 UI 与兼容性专项待补 |

## 2. 测试背景与目标

本轮测试面向 BlueEdge V1.2.0 原型迁移和后续修复代码，验证以下开发内容是否具备继续联调和人工回归的基础：

1. 表单必填项校验、错误定位和公共交互统一。
2. 边缘单元进入、切换和页面上下文一致性修复。
3. EdgeUnit、NodeGroup、Node、Deployment 和 EdgeApplication 的资源归属隔离。
4. 边缘单元节点、工作负载和应用实例统计口径修复。
5. 工作负载创建时的边缘单元归属标记和 NodeGroup 调度约束。
6. 列表分页、命名空间范围和批量任务资源归属改造。
7. 前端与 API Gateway 的构建、单元测试和基础运行状态。

本报告重点回答当前开发分支能否通过基础工程验证，以及还需要哪些测试才能形成正式发布验收结论。

## 3. 版本与变更范围

### 3.1 版本边界

当前开发分支 HEAD 为 `55fc935`。本轮为它构建并部署了独立测试镜像，不覆盖线上 `blueedge` 命名空间。

| 提交 | 主要内容 |
| --- | --- |
| `05f2a0b` | 修复边缘单元资源归属污染，支持 NodeGroup 绑定与解绑，补充资源隔离测试和测试用例 |
| `55fc935` | 统一资源列表分页、命名空间范围、边缘工作负载归属和批量任务映射 |

版本边界如下：

- 当前 HEAD `55fc935` 已构建为 `20260717-head-55fc935` 测试镜像并部署到 `blueedge-test`。
- 测试环境 Frontend、API Gateway 均为 1/1，Pod 为 Running、0 重启。
- 当前线上 `blueedge` 命名空间观察到 Frontend、API Gateway 为 `2026071703`；本轮没有替换线上镜像。
- 线上标签对应的源码提交未在镜像元数据中声明，因此不能仅凭 `2026071703` 判断它是否与 HEAD 完全一致。

### 3.2 主要影响模块

- Frontend：边缘单元概览、工作负载、批量任务、边缘应用、节点、Kubernetes 资源列表、公共分页、命名空间面包屑。
- API Gateway：边缘单元资源归属、工作负载创建和统计、批量任务映射、边缘单元路由。
- 自动化测试：边缘单元资源归属、工作负载调度、批量任务、设备事务、指标降级、规则状态和审计映射。

## 4. 测试环境

| 环境项 | 内容 |
| --- | --- |
| 本地工作区 | `/Users/xiongkai/Desktop/bluedot/blueedge` |
| 前端构建工具 | TypeScript + Vite |
| API Gateway | Node.js + TypeScript |
| 线上服务器 | `14.103.163.121` |
| Kubernetes 命名空间 | `blueedge` |
| 线上入口 | `http://14.103.163.121:30080/` |
| 线上健康接口 | `http://14.103.163.121:30080/product-api/healthz` |
| 独立测试命名空间 | `blueedge-test` |
| 独立测试集群入口 | NodePort `30081`；当前公网侧返回空响应 |
| 验证入口 | 通过 Kubernetes Port Forward：Frontend `127.0.0.1:3001`、Gateway `127.0.0.1:7002` |
| 真实写测试命名空间 | `blueedge-e2e`，资源统一使用 `qa-` 前缀并在测试后清理 |

## 5. 测试执行结果

### 5.1 当前开发分支自动化验证

| 测试项 | 执行命令 | 结果 | 状态 |
| --- | --- | --- | --- |
| Frontend 生产构建 | `cd frontend && npm run build` | TypeScript 编译和 Vite 构建成功，2500 个模块完成转换 | 通过 |
| API Gateway 构建 | `cd server/api-gateway && npm run build` | TypeScript 构建成功 | 通过 |
| API Gateway 单元测试 | `cd server/api-gateway && npm test` | 31/31 通过，0 失败、0 跳过 | 通过 |
| Git 空白符检查 | `git diff --check` | 无空白符错误 | 通过 |
| Frontend ESLint | `cd frontend && npm run lint` | 191 errors、7 warnings | 失败 |

前端生产构建产物：

| 产物 | 原始大小 | Gzip 大小 |
| --- | ---: | ---: |
| `dist/index.html` | 0.41 kB | 0.29 kB |
| `dist/assets/index-wuRJPIZq.css` | 131.72 kB | 21.90 kB |
| `dist/assets/index-BghIA0yB.js` | 1,738.13 kB | 448.22 kB |

构建存在单个 JavaScript chunk 超过 500 kB 的警告，不阻断当前构建，但应作为后续性能优化项跟踪。

### 5.2 API Gateway 单元测试覆盖结果

本轮 31 项单元测试全部通过，重点覆盖：

- 显式 NodeGroup 节点和标签选择器生成真实 Deployment 调度约束。
- EdgeUnit 工作负载自动注入边缘单元和 NodeGroup 归属标记。
- 拒绝把工作负载调度到绑定 NodeGroup 范围之外。
- EdgeUnit 更新时可绑定或显式解绑 `nodeGroupRef`。
- 无 `nodeGroupRef` 的 EdgeUnit 统计为 0 节点、0 工作负载、0 应用。
- 同一 Kubernetes 集群中的多个 EdgeUnit 不共享 NodeGroup 资源。
- 未归属 Deployment 不再回退到同集群的所有 EdgeUnit。
- EdgeApplication 支持直接 EdgeUnit 归属和历史 NodeGroup 归属。
- 孤儿历史 NodeGroup 不污染其他 EdgeUnit。
- 工作负载总数和健康数按 NodeGroup 内实际 Pod 运行状态计算。
- 批量任务、设备事务回滚、指标降级、规则状态和审计记录映射。

### 5.3 独立测试镜像与部署结果

| 服务 | 镜像 | 仓库摘要 | 运行时摘要 | 状态 |
| --- | --- | --- | --- | --- |
| Frontend | `183.95.195.121:31438/blueedge/frontend:20260717-head-55fc935` | `sha256:a5a4f2a7060b702902bdcdd2cfa85a270152e92a80d23c15f8c2370928d50fe9` | 同仓库摘要 | 1/1，Running，0 重启 |
| API Gateway | `183.95.195.121:31438/blueedge/api-gateway:20260717-head-55fc935` | `sha256:6453199c143da5bc070bec3c2aa015f7b43fc61b39bbc7c1cc07ce14044f8fe3` | `sha256:1e78c70f4ee80e75a6a3d741bc9aeb9cbf19723243929b5e1e1849efb16be9ed` | 1/1，Running，0 重启 |

两个镜像均为 `linux/amd64`。API Gateway 的仓库摘要是多平台清单摘要，Pod `imageID` 记录的是实际拉取的 amd64 平台清单摘要，因此二者值不同属于正常现象。

独立测试环境验证结果：

| 检查项 | 结果 | 状态 |
| --- | --- | --- |
| Frontend 首页 | HTTP 200 | 通过 |
| Frontend 代理健康接口 | HTTP 200 | 通过 |
| Gateway 直连健康接口 | HTTP 200 | 通过 |
| API Gateway 只读 smoke | 36 通过、0 失败、2 跳过 | 通过 |
| 正确、错误、空凭据和未授权访问 | 200、401、401、401 | 通过 |
| 跳过项 | 脚本默认的 `edge-group` NodeGroup 不存在 | 不属于接口失败 |
| 公网 NodePort `30081` | 空响应，HTTP 000 | 环境网络阻塞；集群内服务正常 |

## 6. 功能测试执行概况

本轮已对当前 HEAD 的独立测试镜像完成以下真实执行，不再只引用旧版测试记录：

| 测试域 | 执行结果 | 状态 |
| --- | --- | --- |
| 登录与鉴权 | 正确登录 200；错误密码、空凭据、未授权访问均为 401 | 通过 |
| 只读接口冒烟 | 36 通过、0 失败、2 跳过 | 通过 |
| EdgeUnit / AccessConfig CRUD | 创建、读取、更新、删除及安装命令字段持久化通过 | 通过 |
| 批量工作负载 | 计划、容器、环境变量、资源限制、详情、取消和删除通过 | 通过 |
| 批量工作负载清理 | 任务和管理的 Deployment 同时删除，确认无 `qa-` 残留 | 通过 |
| EdgeUnit 资源隔离 | A/B/空单元按 1/2/0 应用和差异化 Deployment 数据验证，无跨单元污染 | 通过 |
| 无 NodeGroup EdgeUnit | 节点、工作负载、应用均为 0 | 通过 |
| 分页与搜索接口 | 总数 75；前两页各 5 条无重复；搜索命中；命名空间范围正确 | 通过 |
| BFF 不可用 | 依赖请求返回 502 和明确消息；Gateway 故障前后健康接口均为 200 | 通过 |
| 上游请求超时 | 500ms 阈值下于 0.504s 返回 502 和超时消息；Gateway 保持健康 | 通过 |
| 并发删除 | 两个并发请求返回 200/404，最终查询 404 | 通过 |
| UI 表单、刷新、删除视觉 | 当前无可连接浏览器实例 | 阻塞 |
| Chrome / Edge / 1366×768 | 当前无可连接浏览器实例 | 阻塞 |

完整平台测试用例库仍为 112 条。开发侧本轮已经补齐核心 P0 接口、真实写入、资源隔离、分页接口和依赖异常验证；需要观察焦点、滚动、动画、弹窗和浏览器差异的用例不能通过接口测试代替，继续保留给浏览器人工或自动化回归。

## 7. 重点功能验证分析

| 功能域 | 已验证内容 | 尚缺内容 | 当前判断 |
| --- | --- | --- | --- |
| 登录与鉴权 | 独立测试环境完成正确、错误、空凭据和未授权接口验证 | 登录页提示、跳转、Token 过期和受限账号 UI | 接口通过，UI 待补 |
| 边缘单元上下文 | 创建 A/B/空单元并分别读取资源，接口范围独立 | 连续进入、快速切换、刷新后三处 UI 一致性 | 接口通过，UI 待补 |
| 资源归属与统计 | 单测 31/31；真实集群验证 A/B/空单元差异化资源和 0/0/0 空统计 | 浏览器概览卡片与列表视觉核对 | 核心逻辑通过 |
| 工作负载 | 真实创建、归属注入、调度约束、详情和删除清理通过 | UI 扩缩容、停止和 YAML 操作 | 核心接口通过 |
| 批量任务 | 计划持久化、多容器、环境变量、资源限制、详情、取消、任务及 Deployment 删除通过 | UI 创建、部分失败展示和刷新动画 | 核心接口通过 |
| 公共列表分页 | 前两页无重复、搜索命中、命名空间隔离通过 | 删除末页最后一项后的 UI 页码收敛、空状态视觉 | 接口通过，UI 待补 |
| 表单校验 | 相关代码可以生产构建 | 错误定位、自动滚动、聚焦、错误清除和重复提交 | 阻塞 |
| 删除与刷新 | 真实删除、并发删除和资源清理已通过 | 删除危险视觉、确认/取消和刷新动画 | 接口通过，UI 待补 |
| 异常与兼容性 | BFF 不可用、500ms 上游超时、Gateway 健康边界和并发删除通过 | 浏览器断网、Chrome/Edge 和分辨率适配 | 部分通过 |

## 8. 缺陷与风险

### 8.1 已发现缺陷

| 缺陷编号 | 缺陷描述 | 影响 | 严重程度 | 建议 |
| --- | --- | --- | --- | --- |
| `BE-DEFECT-001` | Frontend ESLint 当前报告 191 errors、7 warnings | 不阻断生产构建，但工程质量门禁未通过，新问题可能被存量问题掩盖 | 一般 | 建立 lint 基线，优先修复本轮新增文件，再分批清理存量问题 |

主要 lint 类型包括：

- `@typescript-eslint/no-explicit-any`
- `react-hooks/set-state-in-effect`
- `react-refresh/only-export-components`
- 未使用变量和 Hook 依赖问题
- `no-constant-binary-expression`

### 8.2 遗留风险

1. **UI 自动化缺口**：当前没有可连接的浏览器实例，表单定位、刷新动画、删除视觉、弹窗、连续上下文切换尚未完成。
2. **浏览器兼容性未执行**：Chrome、Edge 和 1366×768 分辨率仍需测试同事在可用浏览器环境执行。
3. **公网测试入口未开放**：`14.103.163.121:30081` 当前返回空响应；集群内 Pod、Service 和端口转发访问均正常，需核对安全组或 NodePort 暴露策略。
4. **异常专项仍有缺口**：BFF 不可用、500ms 上游超时和并发删除已通过，但浏览器断网恢复、并发编辑冲突尚未执行。
5. **前端包体较大**：主 JavaScript 产物约 1.74 MB，存在大 chunk 警告。
6. **Frontend ESLint 未通过**：191 errors、7 warnings，当前仍不能作为通过的质量门禁。
7. **测试 RBAC 权限较高**：`blueedge-test` 当前沿用现有架构的 `cluster-admin` ServiceAccount 绑定，长期保留前应评估最小权限收敛。

## 9. 测试结论

### 9.1 开发自测结论

当前开发分支在基础工程质量和核心后端逻辑层面达到继续联调条件：

- Frontend 生产构建通过。
- API Gateway 构建通过。
- API Gateway 31/31 单元测试通过。
- 当前 HEAD 独立测试镜像已构建、推送并部署，两个 Deployment 均 1/1、Pod 0 重启。
- 部署环境只读 smoke 36 通过、0 失败、2 跳过。
- 真实增删改查、批量工作负载、资源隔离、分页接口、BFF 故障、上游超时和并发删除均已通过。
- 全部 `qa-` 测试资源已经清理，无 Deployment、NodeGroup 或 EdgeApplication 残留。
- `git diff --check` 通过。

综合结论为：**开发自测通过，当前 HEAD 具备正式提测条件。**

### 9.2 测试团队仍需补充的验收边界

- 表单错误定位、自动滚动、聚焦、刷新动画和删除危险视觉需要浏览器观察。
- 边缘单元连续切换、刷新后上下文保持和页面三处名称一致性需要 UI 验证。
- Chrome、Edge、1366×768 和浏览器断网恢复需要专项环境。
- Frontend ESLint 存量问题需要单独建立整改基线。

以上缺口不影响“开发已完成提测前自测”的结论，但在测试团队完成 UI 和兼容性回归前，不能表述为“V1.2.0 正式发布验收通过”。

## 10. 后续测试建议

开发侧已经完成镜像部署、smoke、差异化资源隔离、真实写入、分页接口、BFF 不可用、上游超时和并发删除。后续建议测试同事按以下顺序执行：

1. 通过集群网络访问 `blueedge-test`，或选择未占用本地端口执行 `kubectl port-forward -n blueedge-test service/blueedge-frontend 3010:80`。
2. 执行表单必填定位、自动滚动和输入后错误清除。
3. 执行边缘单元 A/B 连续进入、快速切换和浏览器刷新后的上下文一致性。
4. 核对列表刷新动画、删除危险视觉、取消删除和错误提示。
5. 执行分页删除末页最后一项、筛选后页码、空列表等 UI 边界。
6. 完成 Chrome、Edge 和 1366×768 分辨率回归。
7. 补充浏览器断网恢复、并发编辑和受限账号权限测试。
8. 登记失败项并复测，所有 P0 UI 用例通过后再给出正式发布验收结论。

## 11. 建议保留的测试证据

- 构建和测试命令完整日志。
- 测试镜像标签、镜像摘要和 Deployment 变更记录。
- 边缘单元概览、列表和集群实际资源数量的对照截图。
- UI 测试截图、Network 请求与响应、浏览器控制台日志。
- 写测试创建的资源 YAML、操作时间和清理结果。
- 缺陷复现步骤、修复提交和复测结论。

## 12. 参考资料

- `BlueEdge-V1.2.0平台测试用例.md`
- `BlueEdge-V1.2.0边缘单元资源归属与统计规则说明.md`
- `AI-chat-history/2026年07月17日-BlueEdge交互统一资源统计修复与线上发版总结.md`
- `BlueEdge-V1.2.0原型迁移复盘与线上发版交接总结.md`
- `server/api-gateway/scripts/smoke-test.sh`
- `server/api-gateway/scripts/crud-regression-test.sh`
- `server/api-gateway/scripts/edge-unit-isolation-regression-test.mjs`
- `deploy/k8s/blueedge-test/runtime.yaml`
- `deploy/k8s/blueedge-test/bff-unavailable.yaml`

## 13. 可直接发送给 Leader / 测试同事的话

> BlueEdge V1.2.0 当前 HEAD `55fc935` 已构建为独立测试镜像 `20260717-head-55fc935` 并部署到 `blueedge-test`。Frontend 和 API Gateway 均为 1/1，Pod Running、0 重启；前端构建通过，Gateway 31/31 单元测试通过，部署环境只读 smoke 36 通过、0 失败、2 跳过。开发侧已经完成登录鉴权、真实增删改查、批量工作负载及 Deployment 清理、A/B/空 EdgeUnit 资源隔离、分页接口、BFF 不可用、500ms 上游超时和并发删除验证，全部 `qa-` 资源已清理。当前结论为“开发自测通过，具备提测条件”。请测试同事重点补充浏览器表单交互、边缘单元连续切换、刷新/删除视觉、分页 UI 边界、Chrome/Edge 和 1366×768 兼容性。当前 Frontend ESLint 仍有 191 errors、7 warnings，建议作为独立质量整改项跟踪。
