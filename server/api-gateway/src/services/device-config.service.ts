import { createHash } from "node:crypto";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import type { DeviceConfigRequest, DeviceExtensionConfig } from "../types/device-config.js";
import { DeviceConfigError, validateDeviceConfigInput } from "../utils/device-config.js";

const deviceApiBase = "/apis/devices.kubeedge.io/v1beta1";
const extensionLabel = "blueedge.io/device-extension";

export interface DeviceConfigK8sClient {
  get(path: string): Promise<any>;
  request(path: string, options?: { method?: string; body?: unknown }): Promise<any>;
}

const defaultClient: DeviceConfigK8sClient = {
  get: getK8sJson,
  request: requestK8sJson,
};

function devicePath(namespace: string, name?: string) {
  const base = `${deviceApiBase}/namespaces/${encodeURIComponent(namespace)}/devices`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

function configMapPath(namespace: string, name?: string) {
  const base = `/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

export function deviceExtensionConfigMapName(namespace: string, deviceName: string) {
  const suffix = createHash("sha256").update(`${namespace}/${deviceName}`).digest("hex").slice(0, 12);
  const prefix = `blueedge-device-config-${deviceName}`.slice(0, 240 - suffix.length).replace(/[.-]+$/, "");
  return `${prefix}-${suffix}`;
}

function isK8sStatus(error: unknown, status: number) {
  return error instanceof Error && error.message.includes(`failed: ${status}`);
}

async function getExistingConfigMap(namespace: string, name: string, client: DeviceConfigK8sClient) {
  try {
    return await client.get(configMapPath(namespace, name));
  } catch (error) {
    if (isK8sStatus(error, 404)) return null;
    throw error;
  }
}

function extensionConfigMap(input: DeviceConfigRequest, device: any, existing?: any) {
  const name = deviceExtensionConfigMapName(input.namespace, input.name);
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name,
      namespace: input.namespace,
      ...(existing?.metadata?.resourceVersion ? { resourceVersion: existing.metadata.resourceVersion } : {}),
      labels: {
        "app.kubernetes.io/managed-by": "blueedge-api-gateway",
        [extensionLabel]: "true",
        ...(input.name.length <= 63 ? { "blueedge.io/device-name": input.name } : {}),
      },
      annotations: {
        "blueedge.io/device-name": input.name,
        "blueedge.io/device-namespace": input.namespace,
      },
      ownerReferences: [{
        apiVersion: "devices.kubeedge.io/v1beta1",
        kind: "Device",
        name: input.name,
        uid: device.metadata.uid,
        controller: false,
        blockOwnerDeletion: false,
      }],
    },
    data: {
      accessConfigYaml: input.accessConfigYaml,
      twinAccessConfigsJson: JSON.stringify(Object.fromEntries(input.properties.map((item) => [item.propertyName, item.accessConfigYaml])), null, 2),
    },
  };
}

function buildDevice(input: DeviceConfigRequest, parsed: ReturnType<typeof validateDeviceConfigInput>, existing?: any) {
  const { protocol: _protocol, ...protocolConfigData } = parsed.accessConfig;
  return {
    apiVersion: "devices.kubeedge.io/v1beta1",
    kind: "Device",
    metadata: {
      name: input.name,
      namespace: input.namespace,
      ...(existing?.metadata?.resourceVersion ? { resourceVersion: existing.metadata.resourceVersion } : {}),
      labels: input.labels || {},
      ...(input.description?.trim() ? { annotations: { "blueedge.io/description": input.description.trim() } } : {}),
    },
    spec: {
      deviceModelRef: { name: input.deviceModelRef },
      ...(input.nodeName?.trim() ? { nodeName: input.nodeName.trim() } : {}),
      protocol: {
        protocolName: input.protocol.trim(),
        configData: protocolConfigData,
      },
      properties: input.properties.map((property) => ({
        name: property.propertyName,
        ...(property.desiredValue?.trim() ? { desired: { value: property.desiredValue.trim() } } : {}),
        collectCycle: property.collectIntervalSeconds,
        reportCycle: property.reportIntervalSeconds,
        reportToCloud: true,
        visitors: {
          protocolName: input.protocol.trim(),
          configData: parsed.parsedTwinConfigs[property.propertyName],
        },
      })),
    },
  };
}

async function validateReferences(input: DeviceConfigRequest, client: DeviceConfigK8sClient) {
  await client.get(`/api/v1/namespaces/${encodeURIComponent(input.namespace)}`).catch((error) => {
    if (isK8sStatus(error, 404)) throw new DeviceConfigError(`命名空间 ${input.namespace} 不存在`, 404);
    throw error;
  });
  const model = await client.get(`${deviceApiBase}/namespaces/${encodeURIComponent(input.namespace)}/devicemodels/${encodeURIComponent(input.deviceModelRef)}`).catch((error) => {
    if (isK8sStatus(error, 404)) throw new DeviceConfigError(`设备模型 ${input.namespace}/${input.deviceModelRef} 不存在`, 404);
    throw error;
  });
  if (input.nodeName?.trim()) {
    await client.get(`/api/v1/nodes/${encodeURIComponent(input.nodeName.trim())}`).catch((error) => {
      if (isK8sStatus(error, 404)) throw new DeviceConfigError(`节点 ${input.nodeName} 不存在`, 404);
      throw error;
    });
  }
  return model;
}

export async function createDeviceConfig(input: DeviceConfigRequest, client: DeviceConfigK8sClient = defaultClient) {
  const model = await validateReferences(input, client);
  const parsed = validateDeviceConfigInput(input, model);
  const device = await client.request(devicePath(input.namespace), { method: "POST", body: buildDevice(input, parsed) });
  try {
    await client.request(configMapPath(input.namespace), { method: "POST", body: extensionConfigMap(input, device) });
  } catch (error) {
    await client.request(devicePath(input.namespace, input.name), { method: "DELETE", body: { propagationPolicy: "Background" } }).catch(() => undefined);
    throw new Error(`扩展配置创建失败，Device 已回滚：${error instanceof Error ? error.message : "unknown error"}`);
  }
  return device;
}

export async function updateDeviceConfig(namespace: string, name: string, input: DeviceConfigRequest, client: DeviceConfigK8sClient = defaultClient) {
  if (input.namespace !== namespace || input.name !== name) throw new DeviceConfigError("路径与请求体中的设备名称或命名空间不一致");
  const model = await validateReferences(input, client);
  const parsed = validateDeviceConfigInput(input, model);
  const oldDevice = await client.get(devicePath(namespace, name));
  const configName = deviceExtensionConfigMapName(namespace, name);
  const oldConfigMap = await getExistingConfigMap(namespace, configName, client);
  const updatedDevice = await client.request(devicePath(namespace, name), { method: "PUT", body: buildDevice(input, parsed, oldDevice) });
  try {
    const configMap = extensionConfigMap(input, updatedDevice, oldConfigMap);
    await client.request(oldConfigMap ? configMapPath(namespace, configName) : configMapPath(namespace), {
      method: oldConfigMap ? "PUT" : "POST",
      body: configMap,
    });
  } catch (error) {
    await client.request(devicePath(namespace, name), { method: "PUT", body: oldDevice }).catch(() => undefined);
    throw new Error(`扩展配置更新失败，Device 已尝试回滚：${error instanceof Error ? error.message : "unknown error"}`);
  }
  return updatedDevice;
}

export async function deleteDeviceConfig(namespace: string, name: string, client: DeviceConfigK8sClient = defaultClient) {
  await client.request(devicePath(namespace, name), { method: "DELETE", body: { propagationPolicy: "Background" } });
  const configName = deviceExtensionConfigMapName(namespace, name);
  await client.request(configMapPath(namespace, configName), { method: "DELETE", body: { propagationPolicy: "Background" } }).catch((error) => {
    if (!isK8sStatus(error, 404)) throw error;
  });
}

export async function getDeviceExtensionConfig(namespace: string, name: string, client: DeviceConfigK8sClient = defaultClient): Promise<DeviceExtensionConfig | null> {
  const configName = deviceExtensionConfigMapName(namespace, name);
  const configMap = await getExistingConfigMap(namespace, configName, client);
  if (!configMap) return null;
  let twinAccessConfigs: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(configMap.data?.twinAccessConfigsJson || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) twinAccessConfigs = parsed;
  } catch {
    twinAccessConfigs = {};
  }
  return {
    storage: "configMap",
    configMapName: configName,
    accessConfigYaml: String(configMap.data?.accessConfigYaml || ""),
    twinAccessConfigs,
  };
}
