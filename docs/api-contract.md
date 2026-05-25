# BlueEdge 第一阶段 API 契约

本文件用于约束自研前端与官方 `kubeedge/dashboard/modules/api` 之间的接口边界。

## 约定

前端请求默认走：

```text
/api
```

Vite 开发环境下代理到：

```text
http://127.0.0.1:8080/api
```

官方 Dashboard 前端源码当前使用 Axios，baseURL 为 `/api`，资源 API 形态包括 `/node`、`/deployment/{namespace}`、`/device/{namespace}`、`/devicemodel/{namespace}`、`/rule/{namespace}`、`/ruleendpoint/{namespace}` 等。

## 第一阶段接口

| 资源 | 路径 | 方法 | 是否命名空间级 | 前端 Adapter |
|---|---|---|---|---|
| Node | `/node` | GET | 否 | `node.adapter.ts` |
| Deployment | `/deployment` / `/deployment/{namespace}` | GET | 是 | `deployment.adapter.ts` |
| Service | `/service` / `/service/{namespace}` | GET | 是 | 待补充 |
| DeviceModel | `/devicemodel` / `/devicemodel/{namespace}` | GET | 是 | `device-model.adapter.ts` |
| Device | `/device` / `/device/{namespace}` | GET | 是 | `device.adapter.ts` |
| RuleEndpoint | `/ruleendpoint` / `/ruleendpoint/{namespace}` | GET | 是 | 待补充 |
| Rule | `/rule` / `/rule/{namespace}` | GET | 是 | `rule.adapter.ts` |

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

