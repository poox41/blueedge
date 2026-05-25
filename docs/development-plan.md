# BlueEdge 开发计划

## P0：工程链路

目标：证明自研前端可以稳定复用官方 KubeEdge Dashboard BFF。

- [ ] 新仓库初始化
- [ ] 引入官方 dashboard submodule
- [ ] 跑通 `modules/api`
- [ ] 跑通自研前端
- [ ] 跑通 api-gateway
- [ ] 完成 token 传递
- [ ] 完成 `/node`、`/deployment`、`/devicemodel`、`/device` 适配

## P1：核心页面真实数据化

- [ ] 首页概览接入 `/product-api/overview`
- [ ] 节点页面接入 `/api/node`
- [ ] Deployment 页面接入 `/api/deployment/{namespace}`
- [ ] DeviceModel 页面接入 `/api/devicemodel/{namespace}`
- [ ] Device 页面接入 `/api/device/{namespace}`
- [ ] Rule / RuleEndpoint 页面接入真实接口
- [ ] 统一 loading / error / empty 状态

## P2：产品化增强

- [ ] 云边拓扑
- [ ] 边缘节点健康评分
- [ ] 设备在线状态概览
- [ ] 边缘应用状态聚合
- [ ] YAML 查看器
- [ ] 资源详情抽屉
- [ ] 删除确认与操作日志

## P3：BlueEdge 差异化能力

- [ ] 一键部署边缘应用模板
- [ ] 设备接入向导
- [ ] Mapper 管理
- [ ] 离线边缘节点诊断
- [ ] 云边同步状态追踪
- [ ] 多集群支持

