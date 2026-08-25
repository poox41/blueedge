# BlueEdge Kubernetes YAML Deployment

This directory deploys BlueEdge with plain Kubernetes YAML. It replaces the Docker Compose deployment with native Kubernetes resources, without Helm.

## Resources

- `blueedge-bff`: KubeEdge Dashboard BFF, port `8080`
- `blueedge-api-gateway`: BlueEdge auth and product API gateway, port `7001`
- `blueedge-frontend`: nginx static frontend and `/product-api/*` proxy, exposed by NodePort `30080`
- `blueedge-dashboard`: ServiceAccount bound to `cluster-admin`

By default, the three BlueEdge platform pods use this node selector:

```yaml
kubernetes.io/hostname: k8s-master
```

This keeps the platform components on the cloud-side node instead of scheduling them to KubeEdge edge nodes. Edit the `nodeSelector` in `10-bff.yaml`, `11-api-gateway.yaml`, and `12-frontend.yaml` if your cloud node has a different hostname.

## Image Requirements

The YAML defaults to these local image tags:

```text
blueedge-frontend:amd64
blueedge-api-gateway:amd64
blueedge-bff:amd64
```

Before applying the YAML, make sure every node that may run these pods can pull or already has these images. For a single-node test cluster, loading images on that node is enough:

```bash
docker load -i blueedge-images-amd64.tar
```

For a multi-node cluster, push images to a registry and update the `image:` fields in:

```text
10-bff.yaml
11-api-gateway.yaml
12-frontend.yaml
```

## Configure Secrets

Do not commit real secrets. Create the runtime Secret in the cluster before deploying the workloads:

```bash
kubectl apply -f deploy/k8s/blueedge/00-namespace.yaml
openssl rand -hex 32
kubectl create secret generic blueedge-secret \
  -n blueedge \
  --from-literal=ADMIN_PASSWORD='<blueedge-admin-password>' \
  --from-literal=JWT_SECRET='<openssl-rand-hex-32-output>' \
  --from-literal=MODEL_REGISTRY_USERNAME='<registry-username>' \
  --from-literal=MODEL_REGISTRY_PASSWORD='<registry-password>'
```

The Secret must provide:

```text
ADMIN_PASSWORD
JWT_SECRET
MODEL_REGISTRY_USERNAME
MODEL_REGISTRY_PASSWORD
```

`MODEL_REGISTRY_URL`、`MODEL_REGISTRY_PREFIX` 和 `MODEL_REGISTRY_SKIP_TLS_VERIFY`
在 `02-configmap.yaml` 中配置。模型更新功能通过 Docker Registry HTTP API V2
自动查询 `${MODEL_REGISTRY_PREFIX}/` 下的模型仓库及其版本标签；生产环境建议为仓库配置可信 CA，
并将 `MODEL_REGISTRY_SKIP_TLS_VERIFY` 设为 `false`。

模型增量发布使用 `ModelSyncTask` CRD。`MODEL_INCREMENTAL_SYNC_ENABLED` 默认必须保持
`false`；只有模型制品发布器、同步 Controller、边缘 Executor 和持久存储全部安装并完成
联调后才能按环境开启。开启前，BAMS 的 `LEGACY_IMAGE` 发布流程保持不变。

增量同步相关配置：

- `MODEL_SYNC_EXECUTOR_IMAGE`：边缘同步器不可变镜像标签或 digest。
- `MODEL_SYNC_STORE_HOST_PATH`：边缘节点模型缓存根目录，默认
  `/var/lib/blueedge/model-store`。
- `MODEL_SYNC_CONTROLLER_ENABLED`：启动 `ModelSyncTask` Reconcile，默认关闭。
- `MODEL_INCREMENTAL_SYNC_ENABLED`：向 BAMS 暴露增量发布能力，默认关闭。

开启顺序必须是：安装 CRD、推送 Executor、配置 Executor 镜像、启动 Controller，确认
Controller 正常后再开启增量能力。Controller 会将 EdgeUnit Registry 的公开 CA 复制到
任务命名空间；Registry 账号密码始终沿用该命名空间现有的 dockerconfigjson Secret。
首次模型发布仍使用 `LEGACY_IMAGE`，后续更新可以使用 `INCREMENTAL_RESTART`。同步成功后
仅目标模型切换到节点持久目录；其他模型保持原 initContainer。切换失败会恢复原 Deployment。

`03-secret.example.yaml` is only a template for teams that prefer declarative Secret files.

## Configure Kubernetes API Access

The default config assumes BlueEdge runs inside the same Kubernetes cluster:

```text
K8S_API_SERVER=https://kubernetes.default.svc
K8S_SKIP_TLS_VERIFY=true
```

The `blueedge-dashboard` ServiceAccount is mounted into pods automatically. The api-gateway reads that token from the standard service account token file when `K8S_TOKEN` is not set.

The AccessConfig install-command endpoint reads the real KubeEdge join token from the Secret maintained by CloudCore. Defaults:

```text
KUBEEDGE_TOKEN_SECRET_NAMESPACE=kubeedge
KUBEEDGE_TOKEN_SECRET_NAME=tokensecret
KUBEEDGE_TOKEN_SECRET_KEY=tokendata
KUBEEDGE_TOKEN_MIN_VALIDITY_SECONDS=300
```

The gateway ServiceAccount must be allowed to `get` that Secret. The current development manifest binds `blueedge-dashboard` to `cluster-admin`; production deployments should replace it with least-privilege RBAC. Install-command responses contain short-lived credentials and must not be logged or cached.

For an external API server, edit `02-configmap.yaml`:

```yaml
K8S_API_SERVER: "https://<apiserver-host>:6443"
```

## Kubernetes And KubeEdge Version Notes

These manifests only use stable Kubernetes APIs available in Kubernetes 1.28:

```text
v1
apps/v1
rbac.authorization.k8s.io/v1
```

KubeEdge 1.22 and Kubernetes 1.28 are not an exact-version match in the KubeEdge compatibility matrix. They are marked as `+`, which means KubeEdge may include features or API objects that are not present in that Kubernetes version. This BlueEdge deployment does not depend on those newer KubeEdge-specific APIs.

## Deploy

Apply all manifests:

```bash
kubectl apply -k deploy/k8s/blueedge
```

If your `kubectl` does not support `-k`, apply files in order:

```bash
kubectl apply -f deploy/k8s/blueedge/00-namespace.yaml
kubectl apply -f deploy/k8s/blueedge/01-rbac.yaml
kubectl apply -f deploy/k8s/blueedge/02-configmap.yaml
kubectl apply -f deploy/k8s/blueedge/10-bff.yaml
kubectl apply -f deploy/k8s/blueedge/11-api-gateway.yaml
kubectl apply -f deploy/k8s/blueedge/12-frontend.yaml
```

## Verify

```bash
kubectl get pods -n blueedge -o wide
kubectl get svc -n blueedge
kubectl rollout status deployment/blueedge-bff -n blueedge --timeout=180s
kubectl rollout status deployment/blueedge-api-gateway -n blueedge --timeout=180s
kubectl rollout status deployment/blueedge-frontend -n blueedge --timeout=180s
```

Open BlueEdge through any node IP:

```text
http://<node-ip>:30080
```

For local verification without NodePort:

```bash
kubectl port-forward -n blueedge svc/blueedge-frontend 3000:80
```

Then open:

```text
http://127.0.0.1:3000
```

## Common Issues

`ImagePullBackOff` means the target node cannot pull `blueedge-*:amd64`, or the images were not loaded on that node.

`401` after login usually means `ADMIN_USERNAME` or `ADMIN_PASSWORD` does not match the configured Secret/ConfigMap.

Kubernetes API errors usually mean `K8S_API_SERVER` is wrong or the ServiceAccount/RBAC was not applied.

## Cleanup

```bash
kubectl delete -k deploy/k8s/blueedge
```

If `-k` is unavailable:

```bash
kubectl delete namespace blueedge
kubectl delete clusterrolebinding blueedge-dashboard-cluster-admin
```
