# 2026年06月10日 - BlueEdge 磁盘恢复、镜像发布与删除 Pod 功能

## 本次目标

恢复 BlueEdge 平台到可用状态，并补齐页面删除 Pod 时后端缺失的接口能力。

## 问题背景

BlueEdge 页面曾出现访问一会儿后不可用、`30080` 端口返回空响应、Pod 大量失败等现象。排查后判断主要和服务器磁盘空间不足有关。磁盘扩容后，需要清理异常资源、恢复核心组件，并重新发布平台镜像。

页面删除 Pod 时出现：

```text
404: Page Not Found
```

原因不是 Kubernetes 里 Pod 不存在，而是前端调用了删除 Pod 的接口，但 BFF 后端没有实现对应的 `DELETE /pod/{namespace}/{name}` 路由。

## 关键原因总结

- 服务器磁盘曾经不足，导致容器运行、镜像拉取、Pod 启动、组件稳定性出现连锁问题。
- 扩容后，BlueEdge/KubeEdge 组件可以恢复，但旧的失败 Pod 需要清理。
- 删除 Pod 页面报 404，是 BFF 功能缺失，不是前端单独的问题。
- 本地 `upstream/kubeedge-dashboard/` 目录被 `.gitignore` 忽略，所以修改后 `git status` 看不到。

## 本次代码修改

新增 BFF 删除 Pod 能力。

修改文件：

```text
upstream/kubeedge-dashboard/modules/api/pkg/handler/pod.go
upstream/kubeedge-dashboard/modules/api/pkg/resource/pod/pod.go
```

新增逻辑：

- 注册 `DELETE /pod/{namespace}/{name}` 路由
- 新增 `handleDeletePod`
- 新增 `pod.DeletePod(...)`
- 调用 Kubernetes Client 删除指定 namespace/name 的 Pod

## 镜像命名规则

后续镜像 tag 采用：

```text
组件-架构-YYYYMMDDNN
```

其中 `NN` 表示当天第几版。

本次 BFF 镜像：

```text
crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:bff-amd64-2026061001
```

## 发布结果

已在服务器上构建并推送镜像：

```text
bff-amd64-2026061001
```

已更新 Kubernetes Deployment：

```text
deployment/blueedge-bff
```

验证结果：

- `blueedge-bff` 新 Pod 为 `1/1 Running`
- Deployment 镜像已指向 `bff-amd64-2026061001`
- 页面同链路删除请求不再返回 `404: Page Not Found`
- 测试删除不存在的 Pod 时返回 `pods "... " not found`，说明请求已经进入 BFF/Kubernetes 逻辑

## 登录配置发现

当前服务器实际配置为：

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=2026@bluedot
```

也就是说，密码记忆是对的，但当前生效账号仍然是 `admin`。

## 本地改代码后发布到服务器的流程

1. 本地修改代码。
2. 如果改的是 `upstream/kubeedge-dashboard/`，注意它被 `.gitignore` 忽略，`git status` 不会显示。
3. 用 `scp` 把改过的文件同步到服务器 `/opt/blueedge/...`。
4. 登录服务器：

```bash
ssh root@14.103.163.121
```

5. 在服务器构建镜像：

```bash
cd /opt/blueedge

nerdctl -n k8s.io build \
  --platform linux/amd64 \
  -t crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:bff-amd64-2026061001 \
  -f deploy/bff.Dockerfile .
```

6. 推送镜像：

```bash
nerdctl -n k8s.io push \
  crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:bff-amd64-2026061001
```

7. 更新 Deployment：

```bash
kubectl set image deployment/blueedge-bff -n blueedge \
  blueedge-bff=crpi-wte052aohcsqbtge.cn-hangzhou.personal.cr.aliyuncs.com/xk-private/blueedge:bff-amd64-2026061001
```

8. 等待滚动发布完成：

```bash
kubectl rollout status deployment/blueedge-bff -n blueedge --timeout=180s
kubectl get pods -n blueedge -o wide
```

## 后续注意事项

- 如果构建时访问 `proxy.golang.org` 超时，可以在 Dockerfile 构建阶段临时加入：

```dockerfile
ENV GOPROXY=https://goproxy.cn,direct GOSUMDB=off
```

- 以后每次新开窗口或完成一个阶段，可以在 `AI-chat-history/` 下新建一个 Markdown 文件记录。
- 文件名以日期开头，后面写这次聊天或任务的主要内容。
