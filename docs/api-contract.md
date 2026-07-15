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

### BatchWorkload Plan

接口：

```text
POST /product-api/blueedge/workloads/batch
GET  /product-api/blueedge/workloads/batch/:taskId
GET  /product-api/blueedge/batch-tasks
```

BatchTask 仍为 `executionMode=planOnly`，不会创建 Deployment。计划使用以下结构：

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

存储模型：`blueedge-system` Namespace 下 BatchTask ConfigMap 的 `data.planJson`。`list/detail` 同时返回解析后的 `plan`。旧数据仍保留 `targetsJson`，服务在创建新计划时可从旧 `targets` 输入转换为标准 `plan`。

正式支持：多容器、镜像拉取策略、env、command、args、CPU/内存资源、生命周期文本、健康检查开关、安全上下文、卷、标签、注解、网络端口和 Deployment 策略。

暂不支持：GPU 资源字段、ConfigMap/Secret 环境变量引用的结构化解析、真实 Deployment 下发、已创建计划 PUT 编辑。对应 UI 已禁用或不再提供可编辑入口。
