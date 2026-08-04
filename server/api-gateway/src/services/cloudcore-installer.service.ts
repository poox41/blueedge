import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { dump } from "js-yaml";
import { config } from "../config.js";
import { getServerK8sAuthorization, getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import { itemsOf, metadataOf } from "../utils/kubernetes.js";

const supportedVersions = new Set(["v1.19.0", "v1.20.0", "v1.21.0", "v1.22.1"]);
const namespace = "kubeedge";
const releaseName = "cloudcore";

export interface CloudCoreInstallOptions {
  version: string;
  accessAddresses: string[];
  protocols: string[];
  mqttEnabled: boolean;
  ports: Record<"websocket" | "quic" | "https" | "cloudStream" | "tunnel", string>;
}

export function buildCloudCoreValues(options: CloudCoreInstallOptions) {
  if (!supportedVersions.has(options.version)) throw new Error(`不支持的 KubeEdge 版本 ${options.version}`);
  const addresses = options.accessAddresses.map((item) => item.trim()).filter(Boolean);
  if (addresses.length === 0) throw new Error("专有边缘单元至少需要一个边缘节点可访问的 CloudCore 地址");
  const port = (key: keyof CloudCoreInstallOptions["ports"]) => {
    const value = Number(options.ports[key]);
    if (!Number.isInteger(value) || value < 30000 || value > 32767) throw new Error(`${key} NodePort 必须在 30000-32767 范围内`);
    return String(value);
  };
  return {
    cloudCore: {
      // The official chart only renders the configured NodePorts when
      // hostNetwork is disabled. BlueEdge exposes CloudCore through the five
      // user-configurable NodePorts, matching the product form.
      hostNetWork: false,
      image: { tag: options.version },
      modules: {
        cloudHub: {
          advertiseAddress: addresses,
          websocket: { enable: options.protocols.includes("WebSocket") },
          quic: { enable: options.protocols.includes("QUIC") },
        },
        taskManager: { enable: true },
      },
      service: {
        enable: true,
        type: "NodePort",
        cloudhubNodePort: port("websocket"),
        cloudhubQuicNodePort: port("quic"),
        cloudhubHttpsNodePort: port("https"),
        cloudstreamNodePort: port("cloudStream"),
        tunnelNodePort: port("tunnel"),
      },
    },
    iptablesManager: { image: { tag: options.version } },
    controllerManager: { enable: true, image: { tag: options.version } },
    admission: { image: { tag: options.version } },
    mosquitto: { enable: options.mqttEnabled },
  };
}

function helmBinary(): string {
  return process.env.HELM_BINARY || "helm";
}

function chartPath(version: string): string {
  const root = process.env.KUBEEDGE_CHART_ROOT || "/opt/blueedge/kubeedge-charts";
  return path.join(root, version, "cloudcore");
}

async function writeKubeconfig(directory: string): Promise<string> {
  if (!config.k8sApiServer) throw new Error("K8S_API_SERVER is not configured");
  const authorization = getServerK8sAuthorization();
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("CloudCore 安装需要服务端 Kubernetes Bearer Token");
  const kubeconfig = path.join(directory, "kubeconfig.yaml");
  await writeFile(kubeconfig, dump({
    apiVersion: "v1",
    kind: "Config",
    clusters: [{ name: "target", cluster: { server: config.k8sApiServer, "insecure-skip-tls-verify": config.k8sSkipTlsVerify } }],
    users: [{ name: "blueedge-installer", user: { token } }],
    contexts: [{ name: "target", context: { cluster: "target", user: "blueedge-installer" } }],
    "current-context": "target",
  }, { noRefs: true }), { mode: 0o600 });
  return kubeconfig;
}

export function runHelm(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(helmBinary(), args, { env: { ...env, HOME: env.HOME || tmpdir() }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => reject(new Error(`无法执行 Helm: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`Helm 执行失败 (${code}): ${(stderr || stdout).trim()}`)));
  });
}

export async function installCloudCore(options: CloudCoreInstallOptions): Promise<void> {
  const values = buildCloudCoreValues(options);
  const directory = await mkdtemp(path.join(tmpdir(), "blueedge-cloudcore-"));
  try {
    const kubeconfig = await writeKubeconfig(directory);
    const valuesFile = path.join(directory, "values.yaml");
    await writeFile(valuesFile, dump(values, { noRefs: true, lineWidth: -1 }), { mode: 0o600 });
    await runHelm([
      "upgrade", "--install", releaseName, chartPath(options.version),
      "--namespace", namespace, "--create-namespace",
      "--kubeconfig", kubeconfig, "--values", valuesFile,
      "--atomic", "--wait", "--timeout", "10m",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function uninstallCloudCore(deleteNamespace: boolean): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "blueedge-cloudcore-"));
  try {
    const kubeconfig = await writeKubeconfig(directory);
    await runHelm(["uninstall", releaseName, "--namespace", namespace, "--kubeconfig", kubeconfig, "--wait", "--timeout", "10m"]);
    if (deleteNamespace) {
      await requestK8sJson(`/api/v1/namespaces/${namespace}`, { method: "DELETE" });
      await waitForNamespaceDeletion();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function namespaceExists(): Promise<boolean> {
  try {
    await getK8sJson(`/api/v1/namespaces/${namespace}`);
    return true;
  } catch (error) {
    if (/\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))) return false;
    throw error;
  }
}

async function forceDeleteTerminatingPods(): Promise<void> {
  const pods = itemsOf(await getK8sJson(`/api/v1/namespaces/${namespace}/pods`));
  await Promise.all(pods.filter((pod) => Boolean(metadataOf(pod).deletionTimestamp)).map((pod) =>
    requestK8sJson(`/api/v1/namespaces/${namespace}/pods/${encodeURIComponent(metadataOf(pod).name)}`, {
      method: "DELETE",
      body: { apiVersion: "v1", kind: "DeleteOptions", gracePeriodSeconds: 0, propagationPolicy: "Background" },
    }).catch((error) => {
      if (!/\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))) throw error;
    })));
}

async function waitForNamespaceDeletion(): Promise<void> {
  const startedAt = Date.now();
  let forced = false;
  while (Date.now() - startedAt < 3 * 60 * 1000) {
    if (!await namespaceExists()) return;
    if (!forced && Date.now() - startedAt >= 30_000) {
      // Unreachable edge nodes can leave DaemonSet pods terminating forever.
      // The user explicitly chose namespace deletion, so clear only pods that
      // Kubernetes has already marked for deletion.
      await forceDeleteTerminatingPods();
      forced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("kubeedge 命名空间删除超时，边缘单元元数据已保留以便重试");
}

export async function cloudCoreAlreadyInstalled(): Promise<boolean> {
  try {
    await getK8sJson(`/api/v1/namespaces/${namespace}/configmaps/cloudcore`);
    return true;
  } catch (error) {
    if (/\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))) return false;
    throw error;
  }
}
