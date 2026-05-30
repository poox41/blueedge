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

打开前端后使用 BlueEdge 平台账号密码登录。浏览器只保存 BlueEdge 平台 JWT，不再保存或暴露 Kubernetes token。

### 1. 初始化官方 BFF

```bash
./scripts/init-upstream.sh
```

这一步会把官方仓库作为 submodule 放到：

```text
upstream/kubeedge-dashboard
```

官方 Dashboard README 说明该项目由 backend 和 frontend 两个模块组成，backend 给 frontend 提供 API，frontend 负责 UI 渲染。官方当前目录下也有 `modules/api`、`modules/common`、`modules/web` 三个核心模块。

### 2. 准备服务端 Kubernetes 凭证

Kubernetes 1.24+ 可以参考：

```bash
kubectl create serviceaccount curl-user -n kube-system
kubectl create clusterrolebinding curl-user-binding \
  --clusterrole=cluster-admin \
  --serviceaccount=kube-system:curl-user
kubectl create token curl-user -n kube-system
```

把生成的 token 配到 api-gateway 进程环境变量，或让 gateway/BFF 通过服务端 kubeconfig、ServiceAccount 等方式访问集群：

```bash
export K8S_TOKEN="<your-kubernetes-token>"
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

关键环境变量：

```text
ADMIN_USERNAME=BlueEdge 登录账号
ADMIN_PASSWORD=BlueEdge 登录密码
JWT_SECRET=用于签发平台 JWT 的长随机密钥
JWT_EXPIRES_IN=24h
BFF_BASE_URL=http://127.0.0.1:8080/api/v1
K8S_API_SERVER=https://127.0.0.1:16443
K8S_TOKEN=<服务器端 Kubernetes token>
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

## 登录与接口验证

```bash
curl -i http://127.0.0.1:7001/overview

TOKEN="$(curl -s http://127.0.0.1:7001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"2026@bluedot","password":"2026@bluedot"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"

curl -i http://127.0.0.1:7001/overview \
  -H "Authorization: Bearer $TOKEN"
```

第一条应返回 `401`，登录成功后第二条业务请求应返回真实数据或集群/BFF 侧错误。

## 第一阶段开发重点

先打通这些接口，不急着扩页面：

```text
/product-api/bff/node
/product-api/bff/deployment
/product-api/bff/service
/product-api/bff/devicemodel
/product-api/bff/device
/product-api/bff/ruleendpoint
/product-api/bff/rule
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
