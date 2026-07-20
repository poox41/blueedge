# BlueEdge 第一阶段 API 契约

本文件用于约束自研前端与官方 `kubeedge/dashboard/modules/api` 之间的接口边界。

## 约定

前端请求默认走：

```text
/api/v1
```

Vite 开发环境下代理到：

```text
http://127.0.0.1:8080/api/v1
```

官方 `kubeedge/dashboard/modules/api` 当前注册的 WebService 前缀为 `/api/v1`。前端 `bffRequest('/node')` 会请求到 `/api/v1/node`，资源 API 形态包括 `/node`、`/deployment/{namespace}`、`/device/{namespace}`、`/devicemodel/{namespace}`、`/rule/{namespace}`、`/ruleendpoint/{namespace}` 等。

## 第一阶段接口

| 资源 | 路径 | 方法 | 是否命名空间级 | 前端 Adapter |
|---|---|---|---|---|
| Node | `/api/v1/node` | GET | 否 | `node.adapter.ts` |
| Deployment | `/api/v1/deployment` / `/api/v1/deployment/{namespace}` | GET | 是 | `deployment.adapter.ts` |
| Service | `/api/v1/service` / `/api/v1/service/{namespace}` | GET | 是 | 待补充 |
| DeviceModel | `/api/v1/devicemodel` / `/api/v1/devicemodel/{namespace}` | GET | 是 | `device-model.adapter.ts` |
| Device | `/api/v1/device` / `/api/v1/device/{namespace}` | GET | 是 | `device.adapter.ts` |
| RuleEndpoint | `/api/v1/ruleendpoint` / `/api/v1/ruleendpoint/{namespace}` | GET | 是 | 待补充 |
| Rule | `/api/v1/rule` / `/api/v1/rule/{namespace}` | GET | 是 | `rule.adapter.ts` |

## Adapter 规范

页面不直接使用 BFF 原始数据，必须转换为 ViewModel：

```ts
const res = await bffRequest('/node')
const nodes = normalizeNodeList(res.data)
```

页面消费：

```ts
EdgeNodeView[]
WorkloadView[]
DeviceModelView[]
DeviceView[]
RuleView[]
```

如果官方 BFF 返回结构变化，优先修改 Adapter，而不是修改页面。

## BlueEdge V1.2.0 真实写入契约

### Connected Cluster

```text
GET /product-api/blueedge/clusters
```

该接口从当前 Kubernetes 的 `kube-system/kubeadm-config` 读取真实 `clusterName`，并返回 Kubernetes 版本和节点数量。创建 EdgeUnit 的“工作集群”下拉框只使用该接口，不再包含静态集群名称或假数据 fallback。当前 Gateway 只连接一个 Kubernetes API，因此响应只有一个 `current=true` 集群。

### EdgeUnit

EdgeUnit 是 BlueEdge 的逻辑资源归属单元，存储在 `blueedge-system` Namespace 下带 `blueedge.io/resource=edgeunit` 标签的 ConfigMap 中；它不是 NodeGroup 的包装，也不会从 NodeGroup 自动生成。

EdgeUnit 不绑定 NodeGroup。专有 EdgeUnit 的节点、Deployment 和 EdgeApplication 通过 `blueedge.io/edge-unit=<edgeUnitName>` 标签声明平台归属；NodeGroup 仅由 EdgeApplication 的 `spec.workloadScope.targetNodeGroups` 作为批量部署目标使用。历史 ConfigMap 中的 `data.nodeGroupRef` 不再参与资源归属，新建和更新 EdgeUnit 时固定清空。

专有 EdgeUnit 使用 `blueedge.io/managed-by=blueedge`、`blueedge.io/node-role=edge` 和 `blueedge.io/edge-unit=<edgeUnitName>` 识别产品管理的专属节点。外接 EdgeUnit 从当前接入工作集群中识别带 `node-role.kubernetes.io/edge` 的节点；仅带 `node-role.kubernetes.io/agent` 时还要求 kubelet 版本包含 `kubeedge`。已经通过 `blueedge.io/edge-unit` 明确归属于其他单元的节点不会被外接单元吸收。

创建专有 EdgeUnit 时从平台支持版本列表中选择 `kubeEdgeVersion`；创建外接 EdgeUnit 时由用户手动填写外接集群实际运行的版本，不限制在专有版本列表中。

EdgeUnit 列表、详情和资源统计只返回真实 EdgeUnit ConfigMap，并按直接归属标签及所属节点上的实际 Pod 计算，不再把同名或未关联的 NodeGroup 合成为 EdgeUnit。

### AccessConfig

接口：

```text
GET    /product-api/blueedge/access-configs
GET    /product-api/blueedge/access-configs/:name
POST   /product-api/blueedge/access-configs
PUT    /product-api/blueedge/access-configs/:name
DELETE /product-api/blueedge/access-configs/:name
GET    /product-api/blueedge/access-configs/:name/install-command
```

`install-command` 会从 Kubernetes Secret 读取 KubeEdge CloudCore 维护的真实接入 Token。成功时返回：

```ts
interface AccessConfigInstallCommandResponse {
  name: string;
  ready: true;
  prepareCommand: string;
  command: string;
  commandTemplate: string;
  missingRequirements: [];
  expiresAt: string;
}
```

该响应包含短期敏感凭证，服务端设置 `Cache-Control: no-store`，调用方不得记录或持久化 `command`。Token 不可用、格式异常或剩余有效期不足时仍返回命令模板，但 `ready=false`。

创建/更新字段：

```ts
interface AccessConfigPayload {
  name?: string;
  edgeUnitRef: string;
  nodeName?: string;
  architecture: "amd64" | "arm64" | "arm";
  os?: string;
  kubeEdgeVersion: string;
  cloudCoreAddress: string;
  protocol?: "https" | "websocket" | "quic";
  driver?: "systemd" | "cgroups";
  criAddress?: string;
  registry?: string;
  description?: string;
  labels?: Record<string, string>;
}
```

存储模型：`blueedge-system` Namespace 下、带 `blueedge.io/resource=access-config` 标签的 ConfigMap。ConfigMap `data` 保存普通字符串字段，`labels` 使用 `labelsJson` JSON 字符串保存。

```text
name, edgeUnitRef, nodeGroupRef, nodeName, architecture, os,
kubeEdgeVersion, cloudCoreAddress, protocol, driver, criAddress,
registry, description, labelsJson, status, createdAt
```

`nodeGroupRef` 仅作为旧数据结构兼容字段保留，新建和更新 AccessConfig 时固定为空；边缘节点不再从 EdgeUnit 继承 NodeGroup。

工作台内创建接入配置时，`edgeUnitRef` 自动继承当前选择的 EdgeUnit；前端无需重复选择。`nodeName` 可省略，服务端默认使用 `name` 作为未来注册的节点名称。

- `driver=systemd` 在安装命令中映射为 `--cgroupdriver=systemd`。
- `driver=cgroups` 在安装命令中映射为 `--cgroupdriver=cgroupfs`。
- `criAddress` 是绝对 Unix Socket 路径，并进入 `--remote-runtime-endpoint`。
- 旧 ConfigMap 未配置字段时返回空字符串，不生成假值。

### Device

Device 创建继续使用官方 BFF：

```text
POST /product-api/bff/device/:namespace
```

当前映射到 KubeEdge `devices.kubeedge.io/v1beta1`：

```text
metadata.name / namespace / labels / description annotation
spec.deviceModelRef.name
spec.nodeName
spec.protocol.protocolName / configData
spec.properties[].name / desired / collectCycle / reportCycle
spec.properties[].visitors.protocolName / configData
```

BlueEdge 同时创建 ownerReference 指向 Device 的扩展 ConfigMap，保存 Access YAML 和 Twin YAML 原始文本，用于刷新和 Gateway 重启后的完整回显。结构化 YAML 对象仍写入 Device CRD，ConfigMap 不替代 CRD。

聚合写接口：

```text
POST   /product-api/blueedge/devices
PUT    /product-api/blueedge/devices/:namespace/:name
DELETE /product-api/blueedge/devices/:namespace/:name
GET    /product-api/blueedge/devices/:namespace/:name/summary
```

删除 Device 时同步清理扩展 ConfigMap，并由 ownerReference 提供垃圾回收兜底。

### BatchWorkload / EdgeApplication

接口：

```text
POST /product-api/blueedge/workloads/batch
GET  /product-api/blueedge/workloads/batch/:taskId
GET  /product-api/blueedge/batch-tasks
```

新建批量工作负载会创建真实的 `apps.kubeedge.io/v1alpha1 EdgeApplication`，并以 `spec.workloadScope.targetNodeGroups` 指定目标节点组。`spec.workloadTemplate.manifests` 中保存实际的 `apps/v1 Deployment` 模板；平台同时保留下列内部计划结构用于列表展示和表单回填：

普通“工作负载”仍创建 `apps/v1 Deployment`，由用户通过 `spec.template.spec.nodeName` 或 `nodeSelector` 选择边缘节点，不再继承或强制绑定 EdgeUnit 的唯一 NodeGroup。EdgeUnit 仅通过 `blueedge.io/edge-unit` 标签记录平台归属。

平台接入的边缘节点使用 `blueedge.io/managed-by=blueedge` 和 `blueedge.io/node-role=edge` 标识产品归属和节点角色。接入命令通过 `keadm join --labels` 写入产品标签；修改已注册节点的接入配置时也会同步标签。只读列表接口不会修改 Kubernetes Node。Deployment 创建表单和服务端默认使用 `blueedge.io/node-role=edge` 约束边缘节点。

```ts
interface BatchWorkloadPlan {
  namespace: string;
  name: string;
  targetGroups: string[];
  replicas: number;
  workloadType: "Deployment";
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  podTemplate: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    containers: Array<{
      name: string;
      image: string;
      imagePullPolicy?: "Always" | "IfNotPresent" | "Never";
      command?: string[];
      args?: string[];
      env?: Array<{ name: string; value: string }>;
      resources?: {
        requests?: { cpu?: string; memory?: string };
        limits?: { cpu?: string; memory?: string };
      };
      lifecycle?: { postStart?: string; preStop?: string };
      healthChecks?: { startup?: boolean; readiness?: boolean; liveness?: boolean };
      securityContext?: Record<string, string | number | boolean>;
      volumes?: Array<{ name: string; type: string; mountPath: string; source?: string }>;
    }>;
    network?: {
      type: "none" | "portmap" | "host";
      ports?: Array<{ containerName: string; containerPort: number; hostPort?: number }>;
    };
    terminationGracePeriodSeconds?: number;
  };
  strategy?: {
    type: "RollingUpdate" | "Recreate";
    maxUnavailable?: string;
    maxSurge?: string;
    revisionHistoryLimit?: number;
    minReadySeconds?: number;
    progressDeadlineSeconds?: number;
  };
}
```

存储模型：真实工作负载保存在业务 Namespace 的 EdgeApplication CR 中；`blueedge-system` Namespace 下的 BatchTask ConfigMap 保存 `data.planJson` 和 EdgeApplication 引用。`list/detail` 同时返回解析后的 `plan`。历史 `executionMode=deployment` 数据继续兼容读取和清理。

正式支持：EdgeApplication YAML 导入与编辑、目标 NodeGroup 追加、多容器、镜像拉取策略、env、command、args、CPU/内存资源、生命周期文本、健康检查开关、安全上下文、卷、标签、注解、网络端口和内嵌 Deployment 策略。

追加目标 NodeGroup 只更新现有 EdgeApplication 的 `workloadScope.targetNodeGroups`，并复用原 `workloadTemplate`；当前版本不在该操作中生成 NodeGroup 差异化 overrides。

暂不支持：GPU 资源字段、ConfigMap/Secret 环境变量引用的结构化解析，以及 EdgeApplication 模式下单独删除某个内嵌 Deployment。
