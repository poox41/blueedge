import { load } from "js-yaml";
import type { DeviceModelSummaryProperty } from "@/api/adapters/device-model-summary.adapter";

export interface DeviceTwinFormValue {
  propertyName: string;
  desiredValue: string;
  collectIntervalSeconds: number;
  reportIntervalSeconds: number;
  accessConfigYaml: string;
}

export interface DeviceConfigPayload {
  name: string;
  namespace: string;
  deviceModelRef: string;
  nodeName?: string;
  protocol: string;
  description?: string;
  labels: Record<string, string>;
  accessConfigYaml: string;
  properties: DeviceTwinFormValue[];
}

const htmlPattern = /<\/?(?:span|div|code|pre|style)\b|color:\s*#[0-9a-f]{3,8}["']?>/i;

export function normalizeDeviceProtocol(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function parseDeviceYaml(value: string, fieldName: string): Record<string, unknown> {
  const source = value.trim();
  if (!source) throw new Error(`${fieldName}不能为空`);
  if (htmlPattern.test(source)) throw new Error(`${fieldName}包含 HTML 高亮内容，请填写纯 YAML 文本`);
  let parsed: unknown;
  try {
    parsed = load(source);
  } catch (error) {
    throw new Error(`${fieldName}解析失败：${error instanceof Error ? error.message : "语法错误"}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${fieldName}根节点必须是对象`);
  return parsed as Record<string, unknown>;
}

export function validateDeviceTwin(
  twin: DeviceTwinFormValue,
  modelProperties: DeviceModelSummaryProperty[],
  existingNames: string[] = [],
) {
  const modelProperty = modelProperties.find((item) => item.name === twin.propertyName);
  if (!modelProperty) throw new Error("请选择设备模型中存在的属性");
  if (existingNames.includes(twin.propertyName)) throw new Error(`孪生属性 ${twin.propertyName} 已存在`);
  if (!Number.isInteger(twin.collectIntervalSeconds) || twin.collectIntervalSeconds <= 0) throw new Error("采样间隔必须为正整数");
  if (!Number.isInteger(twin.reportIntervalSeconds) || twin.reportIntervalSeconds <= 0) throw new Error("上报间隔必须为正整数");
  const value = twin.desiredValue.trim();
  const type = modelProperty.type.toUpperCase();
  if (value && ["INT", "FLOAT", "DOUBLE"].includes(type) && !Number.isFinite(Number(value))) throw new Error(`${modelProperty.name} 的期望值必须是数值`);
  if (value && type === "BOOLEAN" && !["true", "false"].includes(value.toLowerCase())) throw new Error(`${modelProperty.name} 的期望值必须是 true 或 false`);
  parseDeviceYaml(twin.accessConfigYaml, "Twin 访问 YAML");
}

export function validateAccessConfigYaml(value: string, protocol: string) {
  const parsed = parseDeviceYaml(value, "访问配置 YAML");
  const yamlProtocol = typeof parsed.protocol === "string" ? parsed.protocol : "";
  if (!yamlProtocol) throw new Error("访问配置 YAML 缺少 protocol");
  if (normalizeDeviceProtocol(yamlProtocol) !== normalizeDeviceProtocol(protocol)) {
    throw new Error(`访问协议不一致：表单为 ${protocol}，YAML 为 ${yamlProtocol}`);
  }
  return parsed;
}
