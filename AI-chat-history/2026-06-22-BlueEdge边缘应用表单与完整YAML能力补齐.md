# 2026年06月22日 - BlueEdge 边缘应用表单与完整 YAML 能力补齐

## 本次目标

本次围绕 BlueEdge“创建边缘应用”功能进行完善，目标不是只做一个简单镜像表单，而是让表单创建具备接近 Kubernetes 原生 YAML 的实际部署能力，并参考现有边缘工作负载平台的交互布局进行改造。

主要需求包括：

- 通过表单创建完整的 `EdgeApplication`。
- 工作容器与初始化容器使用同一套容器配置能力。
- 初始化容器支持添加任意多个。
- 支持 ConfigMap、Secret、环境变量、启动命令、数据卷、健康检查和安全配置。
- 创建页面改为“基本信息、容器配置、高级配置”三步式全屏布局。
- 边缘应用运行状态以实际生成的 Kubernetes 工作负载为准。
- 详情页展示能够重新部署的完整 YAML，而不是前端拼接的精简 YAML。
- GPU 资源不写死为 `nvidia.com/gpu`，允许填写设备资源名称和数量。

## 对原功能的判断

最开始截图中的 BlueDot“工作负载”功能与 BlueEdge 当前边缘应用功能的业务目标相近，都是通过页面生成 Kubernetes 工作负载。

但 BlueEdge 使用的上层资源是：

```yaml
apiVersion: apps.kubeedge.io/v1alpha1
kind: EdgeApplication
```

它的内部 `workloadTemplate.manifests` 才包含 Deployment、DaemonSet、Job 或 Pod，因此不能只复刻普通 Deployment 表单外观，还必须正确生成 EdgeApplication 的封装结构和边缘节点组调度配置。

## 创建页面布局改造

创建边缘应用页面改为全屏三步式向导：

```text
1. 基本信息
2. 容器配置
3. 高级配置
```

### 基本信息

支持：

- 负载名称
- 负载别名
- 工作负载类型
- 命名空间
- Deployment 实例数
- 描述

### 容器配置

支持分别添加：

- 多个工作容器
- 多个初始化容器
- 多个数据卷
- 多个镜像仓库 Secret

工作容器与初始化容器共用容器编辑模型。Kubernetes 不允许初始化容器配置健康检查和生命周期钩子，因此初始化容器界面会隐藏这些不合法字段，其余配置保持一致。

### 高级配置

高级配置按标签页拆分为：

- 节点调度
- 标签与注解
- 访问配置
- 升级策略
- YAML 预览

页面底部提供固定操作栏：

```text
取消 / 上一步 / 下一步 / 确认创建
```

同时保留独立的 YAML 创建模式，方便直接粘贴完整资源清单。

## 容器字段补齐

### 基本容器配置

每个工作容器和初始化容器支持：

- 容器名称
- 镜像
- `imagePullPolicy`
- CPU requests/limits
- 内存 requests/limits
- GPU 扩展资源
- `workingDir`
- `stdin`
- `tty`

### Command 和 Args

支持以数组形式分别配置：

```yaml
command:
  - /bin/sh
  - -c
args:
  - echo "start"
```

避免把多段参数错误地拼成一个字符串。

### 环境变量

环境变量支持两类配置方式。

逐项添加：

```yaml
env:
  - name: MQTT_BROKER
    value: "127.0.0.1"
  - name: TIMEZONE
    valueFrom:
      configMapKeyRef:
        name: eap-config
        key: TIMEZONE
  - name: API_KEY
    valueFrom:
      secretKeyRef:
        name: app-secret
        key: api-key
```

整体导入 ConfigMap 或 Secret：

```yaml
envFrom:
  - configMapRef:
      name: app-config
  - secretRef:
      name: app-secret
```

整体导入同时支持可选的变量名前缀 `prefix`。

### 容器端口

支持：

- 端口名称
- `containerPort`
- `hostPort`
- `hostIP`
- `TCP`
- `UDP`
- `SCTP`

当访问方式选择“不访问”时，不生成 `hostPort` 和 `hostIP`；选择端口映射时使用容器配置中的端口映射；选择主机网络时生成 `hostNetwork: true`。

### 健康检查

工作容器支持：

- `livenessProbe`
- `readinessProbe`
- `startupProbe`

检查方式支持：

- HTTP 请求
- TCP 端口
- Exec 命令

同时支持延迟时间、检查周期、超时时间和失败阈值。

### 生命周期

工作容器支持：

- `postStart`
- `preStop`

处理方式支持：

- Exec 命令
- HTTP 请求

### 安全配置

支持：

- `privileged`
- `allowPrivilegeEscalation`
- `readOnlyRootFilesystem`
- `runAsNonRoot`
- `runAsUser`
- `runAsGroup`
- capabilities add/drop

## 数据卷与挂载

数据卷支持：

- PersistentVolumeClaim
- ConfigMap
- Secret
- HostPath
- EmptyDir

容器挂载支持：

- `name`
- `mountPath`
- `subPath`
- `subPathExpr`
- `readOnly`

示例生成结构：

```yaml
volumeMounts:
  - name: mysql-config
    mountPath: /etc/mysql/conf.d/my.cnf
    subPath: my.cnf
volumes:
  - name: mysql-config
    configMap:
      name: mysql-config
```

同一个数据卷可以被工作容器和多个初始化容器引用。

## GPU 资源配置调整

原设计相当于默认写死：

```yaml
nvidia.com/gpu: "1"
```

本次改成两个输入框：

```text
设备资源名称：如 nvidia.com/gpu
数量：如 1
```

只有设备资源名称和数量都填写后，才会生成扩展资源限制：

```yaml
resources:
  limits:
    nvidia.com/gpu: "1"
```

这样也可以适配其他设备插件上报的扩展资源名称，不再限定为 Nvidia GPU。

## Pod 与工作负载高级字段

Pod 配置支持：

- `hostNetwork`
- `hostPID`
- `hostIPC`
- `shareProcessNamespace`
- `dnsPolicy`
- `serviceAccountName`
- `runtimeClassName`
- `nodeSelector`
- `terminationGracePeriodSeconds`
- `imagePullSecrets`

工作负载配置支持：

- 工作负载标签
- Pod 标签
- 工作负载注解
- Pod 注解
- Deployment `RollingUpdate`
- Deployment `Recreate`
- `maxUnavailable`
- `maxSurge`
- `minReadySeconds`
- `progressDeadlineSeconds`

## 选填标识

按照参考页面，在非必填配置区域增加“选填”标识，包括：

- 负载别名
- 描述
- 资源配额
- GPU 扩展资源
- 容器端口
- 启动命令
- 环境变量
- 数据卷挂载
- 健康检查
- 生命周期
- 安全配置
- 数据卷

名称、命名空间、容器名称、容器镜像等必填字段继续使用 `*` 标识。

## “处理中”状态修复

排查时发现：

- EdgeApplication CRD 的状态仍然是 `Processing`。
- 它生成的 Deployment 已经满足期望副本数。
- Pod 已经处于 `Running/Ready`。
- 页面只读取 EdgeApplication 控制器状态，因此长时间显示“处理中”。

修复逻辑：

1. 读取 EdgeApplication 注解：

```text
apps.kubeedge.io/last-contained-resources
```

2. 从中找到实际生成的 Deployment。
3. 查询 Deployment 的期望副本数和可用副本数。
4. 仅当：

```text
availableReplicas >= replicas
```

时，将页面状态修正为“运行中”。
5. 如果查询失败或副本未就绪，继续保留控制器原始状态，避免把异常工作负载误判为运行中。

该逻辑同时应用于边缘应用列表和详情。

## 详情页完整 YAML 修复

旧详情页 YAML 是前端手写的简化 Deployment 模板，只包含：

- apiVersion
- kind
- name
- namespace
- labels
- selector
- 单个容器名称和镜像

因此用户在页面里看到的 YAML 与实际部署内容不一致。

本次改为从后端返回的原始 EdgeApplication 对象生成可导出的完整 YAML，保留：

- `spec.workloadScope`
- `spec.workloadTemplate.manifests`
- 所有工作容器
- 所有初始化容器
- command/args
- env/envFrom
- resources
- volumes/volumeMounts
- probes/lifecycle
- securityContext
- 网络和调度配置
- 标签、注解和升级策略

导出时主动排除运行时字段：

- `status`
- `uid`
- `resourceVersion`
- `managedFields`
- 控制器内部注解 `apps.kubeedge.io/last-contained-resources`

因此详情页的“完整 YAML”可以作为重新部署或问题排查的基础，而不是只用于页面展示。

## 主要修改文件

```text
frontend/src/pages/EdgeApps.tsx
frontend/src/components/edge-app/container-model.ts
frontend/src/components/edge-app/ContainerEditor.tsx
frontend/src/components/edge-app/VolumeEditor.tsx
frontend/src/components/edge-app/EdgeAppCreateWizard.tsx
页面接口对接梳理.md
```

各文件职责：

- `container-model.ts`：统一表单数据结构和 Kubernetes/EdgeApplication 资源生成逻辑。
- `ContainerEditor.tsx`：工作容器、初始化容器的复用编辑器。
- `VolumeEditor.tsx`：数据卷定义编辑器。
- `EdgeAppCreateWizard.tsx`：三步式全屏创建向导。
- `EdgeApps.tsx`：列表、详情、创建提交、状态回退和完整 YAML 导出。

## 验证情况

本轮完成过以下验证：

```bash
cd frontend
npm run build
```

前端生产构建通过。

对本次新增文件执行增量 ESLint：

```bash
npx eslint \
  src/components/edge-app/EdgeAppCreateWizard.tsx \
  src/components/edge-app/ContainerEditor.tsx \
  src/components/edge-app/VolumeEditor.tsx \
  src/components/edge-app/container-model.ts
```

增量检查通过。

另外使用资源结构测试验证表单模型能够生成包含以下字段的 EdgeApplication：

- 多工作容器
- 多初始化容器
- ConfigMap/Secret 环境变量
- command/args
- 数据卷和挂载
- GPU 扩展资源
- Deployment 策略

结构测试通过。

仓库全量 ESLint 仍存在较多历史遗留问题，不属于本次新增功能。

## 本次结果

本次改造后，BlueEdge 边缘应用已经从“名称、镜像、简单资源限制”的基础创建表单，扩展为能够覆盖常见 Kubernetes 容器部署字段的三步式创建功能。

当前表单创建和 YAML 创建是两条并存链路：

```text
表单创建
  -> 生成完整 EdgeApplication
  -> workloadTemplate.manifests 中生成 Kubernetes 工作负载

YAML 创建
  -> 直接解析用户输入的 EdgeApplication/标准工作负载 YAML
  -> 保留原生字段
```

详情页也已改为展示完整 EdgeApplication YAML，运行状态则会在控制器状态滞后时参考实际 Deployment 就绪情况。

