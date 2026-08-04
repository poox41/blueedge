import { load, dump } from "js-yaml";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";

const cloudCoreNamespace = "kubeedge";
const cloudCoreConfigMapName = "cloudcore";

export interface IncrementalSyncStatus {
  installed: boolean;
  enabled: boolean;
  edgeController: boolean;
  syncController: boolean;
  cloudHub: boolean;
  taskManager: boolean;
  namespace: string;
  configMap: string;
  message: string;
}

function moduleEnabled(config: any, name: string, defaultValue = false): boolean {
  const value = config?.modules?.[name]?.enable;
  return typeof value === "boolean" ? value : defaultValue;
}

function cloudCoreYaml(configMap: any): { key: string; config: any } {
  const data = configMap?.data || {};
  const key = ["cloudcore.yaml", "cloudcore.yml", "config.yaml", "config.yml"].find((candidate) => typeof data[candidate] === "string");
  if (!key) throw new Error("CloudCore ConfigMap 中未找到 YAML 配置");
  const config = load(data[key]);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("CloudCore YAML 配置格式无效");
  return { key, config };
}

export function buildIncrementalSyncStatus(configMap: any): IncrementalSyncStatus {
  const { config } = cloudCoreYaml(configMap);
  // KubeEdge generated CloudCore configurations enable these controllers by
  // default. An explicit false always wins.
  const edgeController = moduleEnabled(config, "edgeController", true);
  const syncController = moduleEnabled(config, "syncController", true);
  const cloudHub = moduleEnabled(config, "cloudHub", true);
  const taskManager = moduleEnabled(config, "taskManager", false);
  const enabled = cloudHub && edgeController && syncController;
  return {
    installed: true,
    enabled,
    edgeController,
    syncController,
    cloudHub,
    taskManager,
    namespace: cloudCoreNamespace,
    configMap: cloudCoreConfigMapName,
    message: enabled
      ? "CloudCore 增量同步已启用"
      : "CloudCore 已安装，但 cloudHub、edgeController 或 syncController 未启用",
  };
}

function notInstalledStatus(): IncrementalSyncStatus {
  return {
    installed: false,
    enabled: false,
    edgeController: false,
    syncController: false,
    cloudHub: false,
    taskManager: false,
    namespace: cloudCoreNamespace,
    configMap: cloudCoreConfigMapName,
    message: "未检测到 kubeedge/cloudcore ConfigMap，请先安装 KubeEdge CloudCore",
  };
}

function isNotFound(error: unknown): boolean {
  return /\b404\b|not found/i.test(error instanceof Error ? error.message : String(error));
}

async function getCloudCoreConfigMap(): Promise<any | null> {
  try {
    return await getK8sJson(`/api/v1/namespaces/${cloudCoreNamespace}/configmaps/${cloudCoreConfigMapName}`);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function getIncrementalSyncStatus(): Promise<IncrementalSyncStatus> {
  const configMap = await getCloudCoreConfigMap();
  return configMap ? buildIncrementalSyncStatus(configMap) : notInstalledStatus();
}

async function restartCloudCoreDeployment(): Promise<boolean> {
  const path = `/apis/apps/v1/namespaces/${cloudCoreNamespace}/deployments/cloudcore`;
  try {
    const deployment = await getK8sJson(path);
    const annotations = deployment?.spec?.template?.metadata?.annotations || {};
    deployment.spec = deployment.spec || {};
    deployment.spec.template = deployment.spec.template || {};
    deployment.spec.template.metadata = deployment.spec.template.metadata || {};
    deployment.spec.template.metadata.annotations = {
      ...annotations,
      "blueedge.io/restarted-at": new Date().toISOString(),
    };
    await requestK8sJson(path, { method: "PUT", body: deployment });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function enableIncrementalSync(): Promise<IncrementalSyncStatus & { restarted: boolean }> {
  const configMap = await getCloudCoreConfigMap();
  if (!configMap) throw new Error("未检测到 kubeedge/cloudcore ConfigMap，无法启用增量同步；请先安装 KubeEdge CloudCore");

  const { key, config } = cloudCoreYaml(configMap);
  config.modules = config.modules || {};
  for (const moduleName of ["cloudHub", "edgeController", "syncController"]) {
    config.modules[moduleName] = { ...(config.modules[moduleName] || {}), enable: true };
  }
  configMap.data[key] = dump(config, { noRefs: true, lineWidth: -1 });
  const path = `/api/v1/namespaces/${cloudCoreNamespace}/configmaps/${cloudCoreConfigMapName}`;
  const updated = await requestK8sJson(path, { method: "PUT", body: configMap });
  const restarted = await restartCloudCoreDeployment();
  return {
    ...buildIncrementalSyncStatus(updated),
    restarted,
    message: restarted
      ? "CloudCore 增量同步已启用，CloudCore 正在滚动重启"
      : "CloudCore 增量同步配置已启用；未找到 cloudcore Deployment，请手动重启 CloudCore",
  };
}
