# BlueEdge Device 配置持久化设计

## 1. 集群事实

- Kubernetes：v1.28.15。
- Device CRD：`devices.kubeedge.io/v1beta1`，Namespaced，存储版本为 `v1beta1`。
- DeviceModel 引用：`spec.deviceModelRef.name`。
- 节点绑定：`spec.nodeName`。
- 协议配置：`spec.protocol.protocolName` 与 `spec.protocol.configData`。
- 属性配置：`spec.properties[]`，原生支持 `desired`、`collectCycle`、`reportCycle` 和 `visitors.configData`。

## 2. 数据映射

| BlueEdge 输入 | Kubernetes 存储 |
| --- | --- |
| 设备基础信息、标签、描述 | Device `metadata` |
| DeviceModel、Node | Device `spec.deviceModelRef`、`spec.nodeName` |
| Access YAML 的 `protocol` | Device `spec.protocol.protocolName` |
| Access YAML 其余字段 | Device `spec.protocol.configData` |
| Twin 名称、期望值、周期 | Device `spec.properties[]` |
| Twin YAML 解析对象 | Device `spec.properties[].visitors.configData` |
| Access YAML 原始文本 | 关联 ConfigMap `data.accessConfigYaml` |
| 每个 Twin YAML 原始文本 | 关联 ConfigMap `data.twinAccessConfigsJson` |

CRD 保存 Mapper 可消费的结构化对象；ConfigMap 保存用户原始 YAML，避免 Kubernetes JSON 序列化丢失格式、注释和字段顺序。

## 3. 扩展 ConfigMap

ConfigMap 与 Device 位于同一 Namespace，名称由 `namespace/deviceName` 确定性生成。它包含：

```yaml
metadata:
  labels:
    app.kubernetes.io/managed-by: blueedge-api-gateway
    blueedge.io/device-extension: "true"
  ownerReferences:
    - apiVersion: devices.kubeedge.io/v1beta1
      kind: Device
data:
  accessConfigYaml: |-
    ...
  twinAccessConfigsJson: |-
    {"temperature":"..."}
```

完整设备名称和命名空间同时写入 annotations，关联不依赖模糊名称匹配。ownerReference 保证 Device 删除后 ConfigMap 可被 Kubernetes 垃圾回收。

## 4. 接口与事务

- `POST /product-api/blueedge/devices`：校验引用和 YAML，创建 Device，再创建 ConfigMap；ConfigMap 失败时删除已创建 Device。
- `PUT /product-api/blueedge/devices/:namespace/:name`：更新 Device 和 ConfigMap；ConfigMap 更新失败时尝试恢复旧 Device。
- `GET /product-api/blueedge/devices/:namespace/:name/summary`：聚合 Device、DeviceModel、Node 与扩展 YAML。
- `DELETE /product-api/blueedge/devices/:namespace/:name`：删除 Device，并显式清理扩展 ConfigMap；ownerReference 作为兜底。

前端只调用聚合接口，不再分别调用 BFF 与 ConfigMap 接口，因此不会出现 UI 提示成功但只保存一半配置。

## 5. 校验

前后端均检查 Kubernetes 名称、Namespace、DeviceModel、Node、Twin 唯一性、模型属性归属、期望值类型、正整数周期、YAML 语法、YAML 对象根节点及协议一致性。包含 HTML 标签或高亮样式片段的内容会被拒绝。

## 6. Mapper 边界

本实现完成配置真实持久化，并将结构化配置写入当前 Device CRD。具体 Mapper 是否识别 `ModbusTCP`、MQTT 或自定义 `configData` 字段，仍取决于集群部署的 Mapper 实现和协议约定；“配置已保存”不等于“设备已经产生真实采集数据”。
