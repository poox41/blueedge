# BlueEdge K8s YAML 运维部署文档

## 1. 部署目标

将 BlueEdge 平台从 Docker Compose 部署方式切换为 Kubernetes 原生 YAML 部署方式。

本部署不使用 Helm，直接通过 `kubectl apply` 部署。

部署组件：

```text
blueedge-frontend       前端 nginx 服务
blueedge-api-gateway    BlueEdge API 网关
blueedge-bff            KubeEdge Dashboard BFF
```

部署目录：

```text
deploy/k8s/blueedge/
```

## 2. 环境要求

已验证环境：

```text
Kubernetes：v1.28.15
KubeEdge：v1.22
云端节点：k8s-master
前端访问端口：NodePort 30080
```

YAML 使用的 Kubernetes API：

```text
v1
apps/v1
rbac.authorization.k8s.io/v1
```

## 3. 部署文件说明

```text
00-namespace.yaml         创建 blueedge 命名空间
01-rbac.yaml              创建 ServiceAccount 和 ClusterRoleBinding
02-configmap.yaml         BlueEdge 非敏感配置
03-secret.example.yaml    Secret 示例文件，不直接部署真实密码
10-bff.yaml               blueedge-bff Deployment 和 Service
11-api-gateway.yaml       blueedge-api-gateway Deployment 和 Service
12-frontend.yaml          blueedge-frontend Deployment 和 NodePort Service
kustomization.yaml        kustomize 入口
README.md                 说明文档
```

## 4. 镜像要求

YAML 默认使用以下镜像：

```text
blueedge-frontend:amd64
blueedge-api-gateway:amd64
blueedge-bff:amd64
```

需要确保这些镜像已经存在于 Kubernetes 节点使用的 containerd 中。

在目标节点执行：

```bash
nerdctl -n k8s.io images | grep blueedge
```

如果不存在，导入镜像：

```bash
nerdctl -n k8s.io load -i blueedge-images-amd64.tar
```

再次确认：

```bash
nerdctl -n k8s.io images | grep blueedge
```

## 5. 调度说明

当前 YAML 默认将三个 BlueEdge 平台组件调度到云端节点：

```yaml
nodeSelector:
  kubernetes.io/hostname: k8s-master
```

原因：BlueEdge 属于管理面组件，应运行在云端节点，不建议调度到 KubeEdge 边端节点。

如果目标环境的云端节点不是 `k8s-master`，请修改以下文件中的 `nodeSelector`：

```text
10-bff.yaml
11-api-gateway.yaml
12-frontend.yaml
```

也可以改为统一标签，例如：

```bash
kubectl label node <cloud-node-name> blueedge.io/platform-node=true
```

然后将 YAML 改为：

```yaml
nodeSelector:
  blueedge.io/platform-node: "true"
```

## 6. 配置说明

### 6.1 ConfigMap

文件：

```text
02-configmap.yaml
```

默认配置：

```text
ADMIN_USERNAME=admin
JWT_EXPIRES_IN=30d
BFF_BASE_URL=http://blueedge-bff:8080/api/v1
K8S_API_SERVER=https://kubernetes.default.svc
K8S_SKIP_TLS_VERIFY=true
```

如果 BlueEdge 部署在同一个 Kubernetes 集群内，通常保持默认即可。

如果需要连接外部 API Server，请修改：

```yaml
K8S_API_SERVER: "https://<apiserver-host>:6443"
```

### 6.2 Secret

真实密码不要提交到 Git。

部署前手动创建：

```bash
kubectl apply -f deploy/k8s/blueedge/00-namespace.yaml

JWT_SECRET="$(openssl rand -hex 32)"

kubectl create secret generic blueedge-secret \
  -n blueedge \
  --from-literal=ADMIN_PASSWORD='<blueedge-admin-password>' \
  --from-literal=JWT_SECRET="$JWT_SECRET"
```

示例：

```bash
JWT_SECRET="$(openssl rand -hex 32)"

kubectl create secret generic blueedge-secret \
  -n blueedge \
  --from-literal=ADMIN_PASSWORD='2026@bluedot' \
  --from-literal=JWT_SECRET="$JWT_SECRET"
```

如需更新 Secret：

```bash
kubectl delete secret blueedge-secret -n blueedge

JWT_SECRET="$(openssl rand -hex 32)"

kubectl create secret generic blueedge-secret \
  -n blueedge \
  --from-literal=ADMIN_PASSWORD='<blueedge-admin-password>' \
  --from-literal=JWT_SECRET="$JWT_SECRET"
```

## 7. 部署步骤

### 7.1 部署全部资源

在仓库根目录执行：

```bash
kubectl apply -k deploy/k8s/blueedge
```

### 7.2 不使用 kustomize 的部署方式

如果环境不支持 `kubectl apply -k`，按以下顺序执行：

```bash
kubectl apply -f deploy/k8s/blueedge/00-namespace.yaml
kubectl apply -f deploy/k8s/blueedge/01-rbac.yaml
kubectl apply -f deploy/k8s/blueedge/02-configmap.yaml
kubectl apply -f deploy/k8s/blueedge/10-bff.yaml
kubectl apply -f deploy/k8s/blueedge/11-api-gateway.yaml
kubectl apply -f deploy/k8s/blueedge/12-frontend.yaml
```

## 8. 验证步骤

### 8.1 查看 Pod

```bash
kubectl get pods -n blueedge -o wide
```

期望结果：

```text
blueedge-api-gateway   1/1   Running   k8s-master
blueedge-bff           1/1   Running   k8s-master
blueedge-frontend      1/1   Running   k8s-master
```

### 8.2 查看 Service

```bash
kubectl get svc -n blueedge
```

期望结果：

```text
blueedge-api-gateway   ClusterIP   7001/TCP
blueedge-bff           ClusterIP   8080/TCP
blueedge-frontend      NodePort    80:30080/TCP
```

### 8.3 查看 Endpoint

```bash
kubectl get endpoints -n blueedge blueedge-frontend
```

期望存在类似：

```text
10.x.x.x:80
```

### 8.4 Rollout 状态

```bash
kubectl rollout status deployment/blueedge-bff -n blueedge --timeout=180s
kubectl rollout status deployment/blueedge-api-gateway -n blueedge --timeout=180s
kubectl rollout status deployment/blueedge-frontend -n blueedge --timeout=180s
```

### 8.5 集群内访问

先获取 frontend 的 ClusterIP：

```bash
kubectl get svc -n blueedge blueedge-frontend
```

然后执行：

```bash
curl -i http://<blueedge-frontend-cluster-ip>
```

期望返回：

```text
HTTP/1.1 200 OK
Content-Type: text/html
```

### 8.6 外部访问

确保服务器安全组或防火墙已放行：

```text
TCP 30080
```

访问：

```text
http://<node-public-ip>:30080
```

示例：

```text
http://14.103.163.121:30080
```

登录账号：

```text
用户名：admin
密码：部署 Secret 时设置的 ADMIN_PASSWORD
```

## 9. 常见问题

### 9.1 Pod 调度到边端节点

现象：

```text
kubectl get pods -n blueedge -o wide
NODE 显示 k8s-laptop-edge
```

处理：

- 检查 `nodeSelector` 是否正确。
- 确认云端节点存在 `kubernetes.io/hostname=k8s-master` 标签。

查看标签：

```bash
kubectl get node k8s-master --show-labels
```

### 9.2 ImagePullBackOff

原因：

- 镜像未导入到 Kubernetes 使用的 containerd。
- 镜像 tag 与 YAML 不一致。
- 节点架构与镜像架构不一致。

处理：

```bash
nerdctl -n k8s.io images | grep blueedge
nerdctl -n k8s.io load -i blueedge-images-amd64.tar
```

### 9.3 CreateContainerConfigError

可能原因：

- `blueedge-secret` 不存在。

检查：

```bash
kubectl get secret blueedge-secret -n blueedge
```

### 9.4 页面能打开但接口异常

检查 api-gateway 和 bff 日志：

```bash
kubectl logs -n blueedge deploy/blueedge-api-gateway
kubectl logs -n blueedge deploy/blueedge-bff
```

检查配置：

```bash
kubectl get configmap blueedge-config -n blueedge -o yaml
```

重点确认：

```text
BFF_BASE_URL
K8S_API_SERVER
K8S_SKIP_TLS_VERIFY
```

### 9.5 NodePort 外部无法访问

先确认集群内服务是否正常：

```bash
kubectl get endpoints -n blueedge blueedge-frontend
curl -i http://<blueedge-frontend-cluster-ip>
```

如果集群内正常，但公网访问失败，通常是：

```text
服务器安全组未放行 30080
系统防火墙未放行 30080
```

需要开放：

```text
TCP 30080
```

## 10. 更新部署

修改 YAML 后重新应用：

```bash
kubectl apply -k deploy/k8s/blueedge
```

如果更新了镜像但 tag 未变化，可以重启 Deployment：

```bash
kubectl rollout restart deployment/blueedge-frontend -n blueedge
kubectl rollout restart deployment/blueedge-api-gateway -n blueedge
kubectl rollout restart deployment/blueedge-bff -n blueedge
```

## 11. 回滚和清理

### 11.1 删除 K8s 版 BlueEdge

```bash
kubectl delete -k deploy/k8s/blueedge
```

如果不支持 `-k`：

```bash
kubectl delete namespace blueedge
kubectl delete clusterrolebinding blueedge-dashboard-cluster-admin
```

### 11.2 保留 docker-compose 版本

本次 K8s YAML 部署默认使用 NodePort `30080`，不会占用原 docker-compose 版的 `3000` 端口。

因此可以并行验证：

```text
docker-compose 版：http://<node-ip>:3000
K8s YAML 版：http://<node-ip>:30080
```

验证通过后，再决定是否切换正式入口。

## 12. 当前验证结论

在 `14.103.163.121` 环境中已验证：

```text
1. blueedge-frontend / blueedge-api-gateway / blueedge-bff 均 Running
2. 三个 Pod 均调度到 k8s-master
3. Service 和 Endpoint 正常
4. ClusterIP 访问返回 HTTP 200
5. 运维放行 30080 后，公网可通过 http://14.103.163.121:30080 访问
6. 页面仪表板数据正常加载
```

