import { load } from "js-yaml";
import type { DeviceConfigRequest, DevicePropertyInput } from "../types/device-config.js";

const dnsSubdomainPattern = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;
const htmlPattern = /<\/?(?:span|div|code|pre|style)\b|color:\s*#[0-9a-f]{3,8}["']?>/i;

export class DeviceConfigError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export function normalizeProtocol(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function parseYamlObject(value: string, fieldName: string): Record<string, unknown> {
  const source = value.trim();
  if (!source) throw new DeviceConfigError(`${fieldName}不能为空`);
  if (htmlPattern.test(source)) throw new DeviceConfigError(`${fieldName}包含 HTML 高亮内容，请上传或填写纯 YAML 文本`);
  let parsed: unknown;
  try {
    parsed = load(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "语法错误";
    throw new DeviceConfigError(`${fieldName}解析失败：${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DeviceConfigError(`${fieldName}根节点必须是对象`);
  }
  return parsed as Record<string, unknown>;
}

function positiveInteger(value: number, fieldName: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DeviceConfigError(`${fieldName}必须为正整数`);
  }
}

function validateDesiredValue(property: DevicePropertyInput, modelProperty: any) {
  const value = property.desiredValue?.trim() ?? "";
  if (!value) return;
  const type = String(modelProperty?.type || "STRING").toUpperCase();
  if (["INT", "FLOAT", "DOUBLE"].includes(type) && !Number.isFinite(Number(value))) {
    throw new DeviceConfigError(`属性 ${property.propertyName} 的期望值必须是数值`);
  }
  if (type === "BOOLEAN" && !["true", "false"].includes(value.toLowerCase())) {
    throw new DeviceConfigError(`属性 ${property.propertyName} 的期望值必须是 true 或 false`);
  }
}

export function validateDeviceConfigInput(input: DeviceConfigRequest, model: any) {
  if (!input || typeof input !== "object") throw new DeviceConfigError("请求体不能为空");
  if (!input.name || input.name.length > 253 || !dnsSubdomainPattern.test(input.name)) {
    throw new DeviceConfigError("设备名称不符合 Kubernetes DNS 子域名规则");
  }
  if (!input.namespace || !dnsSubdomainPattern.test(input.namespace)) throw new DeviceConfigError("命名空间不合法");
  if (!input.deviceModelRef) throw new DeviceConfigError("必须选择设备模型");
  if (!input.protocol?.trim()) throw new DeviceConfigError("访问协议不能为空");
  if (!Array.isArray(input.properties) || input.properties.length === 0) throw new DeviceConfigError("至少需要配置一个孪生属性");

  const accessConfig = parseYamlObject(input.accessConfigYaml, "访问配置 YAML");
  const yamlProtocol = typeof accessConfig.protocol === "string" ? accessConfig.protocol : "";
  if (!yamlProtocol) throw new DeviceConfigError("访问配置 YAML 缺少 protocol");
  if (normalizeProtocol(yamlProtocol) !== normalizeProtocol(input.protocol)) {
    throw new DeviceConfigError(`访问协议不一致：表单为 ${input.protocol}，YAML 为 ${yamlProtocol}`);
  }

  const modelProperties = Array.isArray(model?.spec?.properties) ? model.spec.properties : [];
  const propertiesByName = new Map(modelProperties.map((item: any) => [String(item?.name || ""), item]));
  const seen = new Set<string>();
  const parsedTwinConfigs: Record<string, Record<string, unknown>> = {};
  for (const property of input.properties) {
    const name = property.propertyName?.trim();
    if (!name || !propertiesByName.has(name)) throw new DeviceConfigError(`孪生属性 ${name || "(空)"} 不属于设备模型 ${input.deviceModelRef}`);
    if (seen.has(name)) throw new DeviceConfigError(`孪生属性 ${name} 不能重复添加`);
    seen.add(name);
    positiveInteger(property.collectIntervalSeconds, `属性 ${name} 的采样间隔`);
    positiveInteger(property.reportIntervalSeconds, `属性 ${name} 的上报间隔`);
    validateDesiredValue(property, propertiesByName.get(name));
    parsedTwinConfigs[name] = parseYamlObject(property.accessConfigYaml, `属性 ${name} 的访问 YAML`);
  }

  return { accessConfig, parsedTwinConfigs };
}
