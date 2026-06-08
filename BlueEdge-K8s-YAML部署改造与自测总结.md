# BlueEdge K8s YAML 部署改造与自测总结

## 1. 背景

运维侧提出：当前 BlueEdge 平台使用 `docker-compose` 部署，后续需要改造成 Kubernetes 原生 YAML 部署方式。

要求：

- 暂时不需要做 Helm Chart。
- 需要可以通过 YAML 直接部署。
- 部署流程应适配 AIPC + KubeEdge 场景。
- 先在当前环境验证，验证通过后运维再部署到他的环境。

当前测试环境：

```text
服务器：14.103.163.121
Kubernetes：v1.28.15
KubeEdge：v1.22
云端节点：k8s-master
边端节点：k8s-laptop-edge
```

## 2. 改造内容

已将 BlueEdge 平台自身从 Docker Compose 部署拆成 Kubernetes YAML。

新增目录：

```text
deploy/k8s/blueedge/
```

包含文件：

```text
00-namespace.yaml
01-rbac.yaml
02-configmap.yaml
03-secret.example.yaml
10-bff.yaml
11-api-gateway.yaml
12-frontend.yaml
kustomization.yaml
README.md
```

对应组件：

```text
blueedge-frontend       前端 nginx 静态资源服务，NodePort 30080
blueedge-api-gateway    BlueEdge 登录鉴权和产品增强 API
blueedge-bff            KubeEdge Dashboard BFF
blueedge-dashboard      ServiceAccount + ClusterRoleBinding
blueedge-config         ConfigMap
blueedge-secret         Secret
```

## 3. 为什么固定调度到 k8s-master

第一次部署时，Kubernetes 将三个 BlueEdge 平台组件调度到了边端节点：

```text
k8s-laptop-edge
```

这不符合预期。BlueEdge 平台自身是管理面/控制面组件，应该部署在云端节点或普通 worker 节点上，而不是边端节点。

原因：

- 边端节点主要用于运行边缘业务负载。
- 边端节点可能存在网络、镜像、架构、日志、exec 通道等差异。
- 本次环境中边端节点是 `arm64`，而 BlueEdge 镜像是 `amd64`。
- BlueEdge 平台需要稳定访问 Kubernetes API 和 KubeEdge 资源。

因此已在三个 Deployment 中固化：

```yaml
nodeSelector:
  kubernetes.io/hostname: k8s-master
```

涉及文件：

```text
10-bff.yaml
11-api-gateway.yaml
12-frontend.yaml
```

后续如果运维希望更通用，可以改成专用标签，例如：

```bash
kubectl label node k8s-master blueedge.io/platform-node=true
```

然后 YAML 改成：

```yaml
nodeSelector:
  blueedge.io/platform-node: "true"
```

## 4. 部署步骤

### 4.1 准备镜像

当前 YAML 默认使用镜像：

```text
blueedge-frontend:amd64
blueedge-api-gateway:amd64
blueedge-bff:amd64
```

需要确保这些镜像已经在 Kubernetes 使用的 containerd 命名空间中。

示例：

```bash
nerdctl -n k8s.io load -i blueedge-images-amd64.tar
nerdctl -n k8s.io images | grep blueedge
```

### 4.2 创建 Namespace

```bash
kubectl apply -f deploy/k8s/blueedge/00-namespace.yaml
```

### 4.3 创建 Secret

用户名在 ConfigMap 中：

```text
ADMIN_USERNAME=admin
```

密码和 JWT Secret 使用 Kubernetes Secret：

```bash
JWT_SECRET="$(openssl rand -hex 32)"

kubectl create secret generic blueedge-secret \
  -n blueedge \
  --from-literal=ADMIN_PASSWORD='2026@bluedot' \
  --from-literal=JWT_SECRET="$JWT_SECRET"
```

如果 Secret 已存在：

```bash
kubectl delete secret blueedge-secret -n blueedge
```

然后重新创建。

### 4.4 应用 K8s YAML

```bash
kubectl apply -k deploy/k8s/blueedge
```

如果环境不支持 `kubectl apply -k`，可按文件顺序部署：

```bash
kubectl apply -f deploy/k8s/blueedge/00-namespace.yaml
kubectl apply -f deploy/k8s/blueedge/01-rbac.yaml
kubectl apply -f deploy/k8s/blueedge/02-configmap.yaml
kubectl apply -f deploy/k8s/blueedge/10-bff.yaml
kubectl apply -f deploy/k8s/blueedge/11-api-gateway.yaml
kubectl apply -f deploy/k8s/blueedge/12-frontend.yaml
```

## 5. 自测过程

### 5.1 第一次部署结果

执行：

```bash
kubectl apply -k deploy/k8s/blueedge
kubectl get pods -n blueedge -o wide
kubectl get svc -n blueedge
```

资源创建成功：

```text
namespace/blueedge created
serviceaccount/blueedge-dashboard created
clusterrolebinding.rbac.authorization.k8s.io/blueedge-dashboard-cluster-admin created
configmap/blueedge-config created
service/blueedge-api-gateway created
service/blueedge-bff created
service/blueedge-frontend created
deployment.apps/blueedge-api-gateway created
deployment.apps/blueedge-bff created
deployment.apps/blueedge-frontend created
```

但三个 Pod 一开始调度到了：

```text
k8s-laptop-edge
```

状态为：

```text
ContainerCreating
```

通过 `kubectl describe pod` 确认：

```text
Successfully assigned blueedge/blueedge-frontend-... to k8s-laptop-edge
```

判断为调度节点不符合预期。

### 5.2 临时修复调度

执行 patch，将三个 Deployment 调度到 `k8s-master`：

```bash
kubectl patch deployment blueedge-frontend -n blueedge \
  --type='merge' \
  -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/hostname":"k8s-master"}}}}}'

kubectl patch deployment blueedge-api-gateway -n blueedge \
  --type='merge' \
  -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/hostname":"k8s-master"}}}}}'

kubectl patch deployment blueedge-bff -n blueedge \
  --type='merge' \
  -p '{"spec":{"template":{"spec":{"nodeSelector":{"kubernetes.io/hostname":"k8s-master"}}}}}'
```

随后检查：

```bash
kubectl get pods -n blueedge -o wide
```

结果：

```text
blueedge-api-gateway   1/1   Running   k8s-master
blueedge-bff           1/1   Running   k8s-master
blueedge-frontend      1/1   Running   k8s-master
```

之后已将该 nodeSelector 固化进 YAML。

### 5.3 Service 和 Endpoint 验证

执行：

```bash
kubectl get svc -n blueedge
kubectl get endpoints -n blueedge blueedge-frontend
```

结果中 `blueedge-frontend` 暴露为 NodePort：

```text
blueedge-frontend   NodePort   80:30080/TCP
```

Endpoint 正常：

```text
blueedge-frontend   10.244.2.64:80
```

### 5.4 集群内访问验证

执行：

```bash
curl -i http://10.245.14.123
```

返回：

```text
HTTP/1.1 200 OK
Server: nginx/1.27.5
Content-Type: text/html
```

说明 K8s 内部 Service 到 Pod 的链路正常。

### 5.5 外部访问验证

起初访问：

```text
http://14.103.163.121:30080
```

浏览器打不开，判断为服务器安全组或防火墙未放行 `30080`。

随后运维开放端口 `30080`，再次访问：

```text
http://14.103.163.121:30080
```

页面正常打开，仪表板数据正常加载。

说明外部访问链路已打通：

```text
Browser
  -> NodePort 30080
  -> blueedge-frontend Service
  -> blueedge-frontend Pod
  -> /product-api proxy
  -> blueedge-api-gateway Service/Pod
  -> blueedge-bff Service/Pod
  -> Kubernetes API / KubeEdge resources
```

## 6. 自测结论

当前 BlueEdge K8s YAML 部署方式已在 `14.103.163.121` 环境验证通过。

验证通过项：

```text
1. Namespace / RBAC / ConfigMap / Service / Deployment 创建成功
2. blueedge-frontend / blueedge-api-gateway / blueedge-bff 均 1/1 Running
3. 三个 Pod 均调度到 k8s-master
4. Service / Endpoint 正常
5. 集群内 ClusterIP 访问正常
6. NodePort 30080 对外访问正常
7. 页面仪表板数据正常加载
```

## 7. 已知注意事项

### 7.1 端口放行

K8s YAML 默认通过 NodePort 暴露：

```text
30080
```

如果公网访问失败，需要检查：

```text
服务器安全组
系统防火墙
NodePort 是否监听
```

### 7.2 镜像位置

如果镜像没有导入到 Kubernetes 使用的 containerd 命名空间，会出现：

```text
ImagePullBackOff
```

需要执行：

```bash
nerdctl -n k8s.io load -i blueedge-images-amd64.tar
```

### 7.3 K8s 和 KubeEdge 版本

当前环境：

```text
Kubernetes v1.28.15
KubeEdge v1.22
```

二者不是最理想的完全匹配版本，但本次 BlueEdge 平台部署 YAML 只使用基础 Kubernetes API：

```text
v1
apps/v1
rbac.authorization.k8s.io/v1
```

因此本次平台部署不需要先升级 K8s。

### 7.4 当前 YAML 写死 k8s-master

当前为了测试环境稳定，YAML 中写死：

```yaml
nodeSelector:
  kubernetes.io/hostname: k8s-master
```

如果运维环境云端节点名称不同，需要修改为实际云端节点，或改成统一标签，例如：

```yaml
nodeSelector:
  blueedge.io/platform-node: "true"
```

## 8. 给运维的简短说明

可以同步给运维：

```text
BlueEdge 已从 docker-compose 部署方式改造成 K8s 原生 YAML 部署方式，暂未做 Helm。

已在 14.103.163.121 环境验证通过：
- blueedge-frontend / blueedge-api-gateway / blueedge-bff 三个 Deployment 均 Running
- 均调度在 k8s-master
- Service / Endpoint 正常
- 集群内访问正常
- 运维开放 30080 后，外部可通过 http://14.103.163.121:30080 正常访问页面，仪表板数据正常加载

目前 YAML 默认通过 NodePort 30080 暴露，默认 nodeSelector 为 kubernetes.io/hostname=k8s-master。
```

