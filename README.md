# BlueEdge Starter

BlueEdge 是基于 KubeEdge Dashboard BFF 的自研产品化前端工程骨架。

## 架构原则

```text
frontend 自研前端
  ↓
src/api/adapters 接口适配层
  ↓
server/api-gateway 产品增强层，可选
  ↓
upstream/kubeedge-dashboard/modules/api 官方 BFF
  ↓
Kubernetes API Server / KubeEdge CRD
```

核心原则：

1. 前端完全自研，保留产品化 UI 自由度。
2. BFF 复用官方 `kubeedge/dashboard/modules/api`。
3. 产品增强能力放在 `server/api-gateway`，不直接污染官方 BFF。
4. 页面不直接消费 BFF 原始返回，统一经过 `frontend/src/api/adapters`。
5. 每次同步 upstream 后，必须跑契约测试和页面冒烟测试。

## 当前内置内容

```text
frontend/                         # 从已有 UI 原型整理出的 BlueEdge 前端
server/api-gateway/               # 产品增强层，当前包含 /overview 示例
scripts/init-upstream.sh          # 初始化官方 dashboard submodule
scripts/sync-upstream.sh          # 同步官方 dashboard
scripts/run-bff.sh                # 启动官方 modules/api
scripts/run-gateway.sh            # 启动 BlueEdge api-gateway
scripts/run-frontend.sh           # 启动前端
scripts/contract-test.sh          # BFF 接口契约冒烟检查
docs/api-contract.md              # 第一阶段接口契约
docs/development-plan.md          # 开发计划
```

## 第一次启动

### 一键启动本地联调栈

当前本地联调可以直接运行：

```bash
./scripts/run-dev-stack.sh start
```

脚本会启动：

```text
SSH 隧道：127.0.0.1:16443 -> 192.168.16.52:6443
官方 BFF：http://127.0.0.1:8080/api/v1
api-gateway：http://127.0.0.1:7001
frontend：http://localhost:3000
```

查看状态或停止：

```bash
./scripts/run-dev-stack.sh status
./scripts/run-dev-stack.sh stop
```

Kubernetes token 仍需手动写入浏览器：

```js
localStorage.setItem("token", JSON.stringify("<your-token>"))
localStorage.setItem("kubeedge_auth", "true")
location.reload()
```

### 1. 初始化官方 BFF

```bash
./scripts/init-upstream.sh
```

这一步会把官方仓库作为 submodule 放到：

```text
upstream/kubeedge-dashboard
```

官方 Dashboard README 说明该项目由 backend 和 frontend 两个模块组成，backend 给 frontend 提供 API，frontend 负责 UI 渲染。官方当前目录下也有 `modules/api`、`modules/common`、`modules/web` 三个核心模块。

### 2. 准备 Kubernetes token

Kubernetes 1.24+ 可以参考：

```bash
kubectl create serviceaccount curl-user -n kube-system
kubectl create clusterrolebinding curl-user-binding \
  --clusterrole=cluster-admin \
  --serviceaccount=kube-system:curl-user
kubectl create token curl-user -n kube-system
```

前端登录后会把 token 写到 localStorage。开发联调时也可以手动写入：

```js
localStorage.setItem('token', JSON.stringify('<your-token>'))
```

### 3. 启动官方 BFF

```bash
export KUBE_APISERVER=https://127.0.0.1:6443
export APISERVER_SKIP_TLS_VERIFY=true
./scripts/run-bff.sh
```

默认假设 BFF 运行在：

```text
http://127.0.0.1:8080/api/v1
```

### 4. 启动产品增强层

```bash
cd server/api-gateway
cp .env.example .env
npm install
npm run dev
```

默认运行在：

```text
http://127.0.0.1:7001
```

### 5. 启动前端

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

默认运行在：

```text
http://127.0.0.1:3000
```

## 第一阶段开发重点

先打通这些接口，不急着扩页面：

```text
/api/v1/node
/api/v1/deployment
/api/v1/service
/api/v1/devicemodel
/api/v1/device
/api/v1/ruleendpoint
/api/v1/rule
```

对应前端封装：

```text
frontend/src/api/request.ts
frontend/src/api/services/resources.ts
frontend/src/api/adapters/*.adapter.ts
frontend/src/types/kubeedge.ts
```

## 同步官方 Dashboard

```bash
./scripts/sync-upstream.sh
./scripts/contract-test.sh
```

同步后先检查 BFF 接口是否仍然可用，再改前端 adapter。
