# 2026年06月10日 - BlueEdge YAML 原生字段验证与线上镜像发布

## 本次目标

运维提出需要验证 BlueEdge 通过 YAML 创建 Kubernetes Deployment 时，是否支持并保留以下原生字段：

```text
containers[].ports[].hostPort
hostNetwork
imagePullSecrets
tolerations
```

要求是：UI 可以先不做完整表单，但通过 YAML 粘贴创建时不能丢字段，不能因为字段不支持而报错，最终创建出的 Pod 能正常运行或字段能正常生效。

## 运维提供的 YAML

运维提供了三份 Deployment YAML：

```text
/Users/xiongkai/Desktop/yolov8n-model.yaml
/Users/xiongkai/Desktop/yolov8n-web.yaml
/Users/xiongkai/Desktop/mapper.yaml
```

这三份文件后来整理为仓库内验证版：

```text
deploy/k8s/ovms-yolov8n/yolov8n-model.yaml
deploy/k8s/ovms-yolov8n/yolov8n-web.yaml
deploy/k8s/ovms-yolov8n/mapper.yaml
```

主要调整：

- 将原来的 `aipc-31` 节点亲和性改为当前集群节点 `k8s-master`。
- 给 `ov-web` 增加 `hostPort: 8008`，用于明确验证 `containers[].ports[].hostPort`。
- 将 `ov-model` 的 hostPath 从 `Directory` 改为 `DirectoryOrCreate`，避免 `/mnt/c/models` 不存在时 Pod 启动失败。

## 关键排查结论

BlueEdge 创建链路本身没有裁剪这些 Kubernetes 原生字段：

```text
YAML 文本
  -> 前端 js-yaml 解析成对象
  -> POST /product-api/bff/deployment/{namespace}
  -> api-gateway 原样转发
  -> 官方 BFF 使用 appsv1.Deployment 接收
  -> Kubernetes API 创建 Deployment
```

因此字段理论上不会被 BFF 丢弃。

之前运维说“要么丢配置，要么报错”，本轮拆开确认：

- “丢配置”：主要是旧详情页 YAML 使用前端简化模板拼出来，页面看起来丢字段；实际 Kubernetes 对象里字段没有丢。
- “报错”：主要是运行环境问题，不是字段不支持。

## 运行环境问题与处理

### 1. hostPath 目录不存在

最初检查：

```bash
ls /mnt/c/models
```

返回：

```text
No such file or directory
```

原 YAML 使用：

```yaml
hostPath:
  path: /mnt/c/models
  type: Directory
```

该类型要求宿主机目录必须已经存在，因此改为：

```yaml
hostPath:
  path: /mnt/c/models
  type: DirectoryOrCreate
```

### 2. 镜像仓库 TLS 证书问题

测试镜像拉取时最初失败：

```text
x509: cannot validate certificate for 183.95.195.121 because it doesn't contain any IP SANs
```

原因是 containerd 拉取：

```text
https://183.95.195.121:31438
```

但仓库证书没有包含 IP SAN。

处理方式是在 `k8s-master` 上为 containerd 配置该 registry 跳过证书校验：

```bash
mkdir -p /etc/containerd/certs.d/183.95.195.121:31438

cat > /etc/containerd/certs.d/183.95.195.121:31438/hosts.toml <<'EOF'
server = "https://183.95.195.121:31438"

[host."https://183.95.195.121:31438"]
  capabilities = ["pull", "resolve"]
  skip_verify = true
EOF
```

后续发现 `/etc/containerd/config.toml` 中 `config_path` 被写成了冒号分隔：

```toml
config_path = '/etc/containerd/certs.d:/etc/docker/certs.d'
```

containerd 不支持这种 PATH 写法，需要改为：

```toml
config_path = "/etc/containerd/certs.d"
```

然后重启：

```bash
systemctl restart containerd
systemctl restart kubelet
```

之后通过 Kubernetes Pod 方式验证镜像拉取成功：

```bash
kubectl run image-pull-test \
  -n default \
  --image=183.95.195.121:31438/openvino/yolo-web:2026052901 \
  --restart=Never \
  --overrides='{"spec":{"nodeName":"k8s-master","imagePullSecrets":[{"name":"my-registry-secret"}]}}'
```

结果：

```text
image-pull-test   1/1   Running
```

说明：

- `k8s-master` 能访问仓库。
- containerd 的 `skip_verify` 生效。
- `my-registry-secret` 可正常认证拉取镜像。

## YAML 创建验证结果

### ov-model

通过 BlueEdge YAML 创建后，Deployment 字段保留：

```yaml
hostNetwork: true
imagePullSecrets:
- name: my-registry-secret
tolerations:
- effect: NoSchedule
  key: node-role.kubernetes.io/edge
  operator: Exists
volumes:
- hostPath:
    path: /mnt/c/models
    type: DirectoryOrCreate
```

Pod 状态：

```text
ov-model-fc97bf764-jc46c   1/1   Running   k8s-master
```

镜像成功拉取：

```text
Successfully pulled image "183.95.195.121:31438/model/yolov8n:0.0.1"
```

### ov-web

通过 BlueEdge YAML 创建后，执行：

```bash
kubectl get deploy ov-web -n default -o jsonpath='{.spec.template.spec.hostNetwork}{"\n"}{.spec.template.spec.containers[0].ports[0].containerPort}{"\n"}{.spec.template.spec.containers[0].ports[0].hostPort}{"\n"}{.spec.template.spec.imagePullSecrets[0].name}{"\n"}{.spec.template.spec.tolerations[0].key}{"\n"}'
```

输出：

```text
true
8008
8008
my-registry-secret
node-role.kubernetes.io/edge
```

说明以下字段均已保留并生效：

- `hostNetwork`
- `containerPort`
- `hostPort`
- `imagePullSecrets`
- `tolerations`

Pod 状态：

```text
ov-web-66b7846b4d-s7mlc   1/1   Running
```

### ovms-mapper

通过 BlueEdge YAML 创建后：

- Deployment 创建成功。
- 镜像拉取成功。
- 字段保留。
- 容器业务进程报 `Exit Code: 1`，进入 `CrashLoopBackOff`。

这不是 YAML 字段支持问题，而是容器内部业务配置问题。该容器使用：

```text
WINDOWS_HOST=127.0.0.1
MQTT_BROKER=127.0.0.1
```

在 `hostNetwork: true` 下，`127.0.0.1` 指的是 `k8s-master` 宿主机。如果宿主机没有对应 Windows 服务或 MQTT 服务，业务进程可能会退出。

## 前端页面改动

修改文件：

```text
frontend/src/pages/Deployments.tsx
frontend/src/types/js-yaml.d.ts
```

### 1. 详情页 YAML 展示改造

旧逻辑是前端手写简化模板，只展示常见字段，导致 `hostNetwork`、`hostPort`、`imagePullSecrets`、`tolerations` 看起来丢失。

新逻辑改为：

```ts
function yamlTemplate(d: Deployment) {
  return yaml.dump(d.raw, { noRefs: true });
}
```

也就是详情页 YAML 展示后端返回的真实 Kubernetes 对象。

### 2. 详情概览补充原生字段展示

Deployment 详情概览新增展示：

- 主机网络：`hostNetwork`
- DNS 策略：`dnsPolicy`
- 端口映射：`containerPort -> hostPort`
- 镜像拉取 Secret：`imagePullSecrets`
- 容忍配置：`tolerations`

示例页面显示：

```text
主机网络：启用
DNS 策略：ClusterFirstWithHostNet
镜像拉取 SECRET：my-registry-secret
容忍配置：node-role.kubernetes.io/edge op=Exists effect=NoSchedule
```

对 `ov-web` 应显示：

```text
container 8008 -> host 8008/TCP
```

### 3. 表单创建补充原生字段

表单创建也补齐了与 YAML 创建对应的可选字段：

- `主机网络` -> `spec.template.spec.hostNetwork`
- 自动配套 `dnsPolicy: ClusterFirstWithHostNet`
- `映射主机端口` -> `containers[].ports[].hostPort`
- `镜像拉取 Secret` -> `imagePullSecrets`
- `容忍配置` -> `tolerations`

这样避免出现“YAML 创建支持，但表单创建不支持”的能力不一致。

## 前端构建验证

多次执行：

```bash
cd frontend
npm run build
```

均通过。

## 线上镜像发布准备

用户指出线上版本仍旧，甚至没有 YAML 部署能力，因此需要更新三套组件：

- `blueedge-frontend`
- `blueedge-api-gateway`
- `blueedge-bff`

已构建并推送到阿里云 ACR：

```text
crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:frontend-amd64-2026061003
crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:api-gateway-amd64-2026061002
crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:bff-amd64-2026061002
```

说明：

- `frontend-amd64-2026061002` 已推送，但不包含后来新增的表单高级字段。
- 因此前端最终线上应使用 `frontend-amd64-2026061003`。
- api-gateway 和 BFF 没有在表单字段改动后再变更，因此继续使用 `2026061002`。

本地 K8s 清单也已更新：

```text
deploy/k8s/blueedge/10-bff.yaml
deploy/k8s/blueedge/11-api-gateway.yaml
deploy/k8s/blueedge/12-frontend.yaml
```

对应镜像 tag：

```text
bff-amd64-2026061002
api-gateway-amd64-2026061002
frontend-amd64-2026061003
```

## 线上更新命令

由于当前本地无法 SSH 登录 `14.103.163.121`，返回：

```text
Permission denied (publickey,password)
```

因此需要在 `k8s-master` 上执行：

```bash
kubectl set image deployment/blueedge-bff -n blueedge \
  blueedge-bff=crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:bff-amd64-2026061002

kubectl set image deployment/blueedge-api-gateway -n blueedge \
  blueedge-api-gateway=crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:api-gateway-amd64-2026061002

kubectl set image deployment/blueedge-frontend -n blueedge \
  blueedge-frontend=crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:frontend-amd64-2026061003
```

等待滚动发布：

```bash
kubectl rollout status deployment/blueedge-bff -n blueedge --timeout=180s
kubectl rollout status deployment/blueedge-api-gateway -n blueedge --timeout=180s
kubectl rollout status deployment/blueedge-frontend -n blueedge --timeout=180s
kubectl get pods -n blueedge -o wide
```

确认镜像：

```bash
kubectl get deploy -n blueedge blueedge-frontend blueedge-api-gateway blueedge-bff \
  -o custom-columns=NAME:.metadata.name,IMAGE:.spec.template.spec.containers[0].image
```

## 最终结论

本轮已经证明：

1. BlueEdge 通过 YAML 创建 Deployment 时，支持并保留 Kubernetes 原生字段：
   - `containers[].ports[].hostPort`
   - `hostNetwork`
   - `imagePullSecrets`
   - `tolerations`
2. 之前“看起来丢字段”主要是详情页 YAML 展示模板不完整，不是 Kubernetes 对象真的丢字段。
3. 之前“报错”主要来自运行环境：
   - hostPath 目录不存在
   - containerd 拉私有仓库镜像时 TLS 证书 IP SAN 校验失败
   - 业务容器 `ovms-mapper` 启动后自身退出
4. 已补齐详情页展示、YAML 真实对象展示、表单创建高级字段。
5. 已构建并推送线上三组件镜像，待在 `k8s-master` 执行 `kubectl set image` 完成线上滚动更新。
