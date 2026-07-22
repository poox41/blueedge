import {
  accessConfigResourceValue,
  blueedgeNamespace,
  blueedgeResourceLabel,
  create,
  ensureNamespace,
  listByResourceLabel,
  remove,
  update,
} from "../repositories/blueedge-configmap.repository.js";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import { config } from "../config.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  dataOf,
  isNodeReady,
  labelsOf,
  metadataOf,
  nodeByName,
} from "../utils/kubernetes.js";
import {
  isHostPort,
  isValidKubernetesName,
  parseJsonField,
  readStringField,
} from "../utils/validation.js";
import {
  getEdgeUnitNodes,
  resolveEdgeUnitReference,
} from "./edge-unit-source.service.js";

const accessConfigNameLabel = "blueedge.io/access-config";
const accessConfigProtocols = new Set(["https", "websocket", "quic", "QUIC"]);
const accessConfigDrivers = new Set(["systemd", "cgroups"]);
const accessConfigStatuses = new Set(["pending", "registered", "ready", "abnormal", "expired", "unknown"]);
const accessConfigDefaultPorts = { websocket: "30000", quic: "30001", https: "30002" } as const;
const blueedgeNodeLabels = {
  "blueedge.io/managed-by": "blueedge",
  "blueedge.io/node-role": "edge",
};

function accessConfigResourceName(name: string): string {
  return `access-config-${name}`;
}

function normalizeAccessConfigProtocol(value: string | undefined): string {
  if (!value) return "https";
  if (value === "QUIC") return "quic";
  return accessConfigProtocols.has(value) ? value : "";
}

function formatCloudCoreEndpoint(address: string, port: string): string {
  const trimmedAddress = address.trim();
  const trimmedPort = port.trim();
  if (!trimmedAddress || !/^\d+$/.test(trimmedPort)) return "";
  const bracketedIpv6 = trimmedAddress.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketedIpv6) return `[${bracketedIpv6[1]}]:${trimmedPort}`;
  if (trimmedAddress.includes(":")) {
    const hostWithPort = trimmedAddress.match(/^([^:]+):\d+$/);
    if (hostWithPort) return `${hostWithPort[1]}:${trimmedPort}`;
    return `[${trimmedAddress}]:${trimmedPort}`;
  }
  return `${trimmedAddress}:${trimmedPort}`;
}

export function resolveAccessConfigCloudCoreAddress(
  body: any,
  edgeUnit: { accessAddresses?: string[]; ports?: Partial<Record<"websocket" | "quic" | "https", string>> },
): string {
  const explicitAddress = readStringField(body, "cloudCoreAddress") || "";
  if (explicitAddress) return explicitAddress;

  const normalizedProtocol = normalizeAccessConfigProtocol(readStringField(body, "protocol"));
  const protocol = (normalizedProtocol in accessConfigDefaultPorts ? normalizedProtocol : "https") as keyof typeof accessConfigDefaultPorts;
  const address = edgeUnit.accessAddresses?.find((item) => item.trim()) || "";
  const port = edgeUnit.ports?.[protocol] || accessConfigDefaultPorts[protocol];
  return formatCloudCoreEndpoint(address, port);
}

export function buildAccessConfigData(body: any, existingData?: Record<string, string>, options: { allowNodeName?: boolean } = {}) {
  const name = readStringField(body, "name") || existingData?.name || "";
  const nodeName = options.allowNodeName === false ? existingData?.nodeName || "" : readStringField(body, "nodeName") || existingData?.nodeName || name;
  const edgeUnitRef = readStringField(body, "edgeUnitRef") || existingData?.edgeUnitRef || "";
  // The installation script detects the target machine architecture at runtime.
  // Keep legacy stored values readable, while new records explicitly use auto.
  const architecture = existingData?.architecture || "auto";
  const os = readStringField(body, "os") || existingData?.os || "linux";
  const kubeEdgeVersion = readStringField(body, "kubeEdgeVersion") || existingData?.kubeEdgeVersion || "";
  const cloudCoreAddress = readStringField(body, "cloudCoreAddress") || existingData?.cloudCoreAddress || "";
  const protocol = normalizeAccessConfigProtocol(readStringField(body, "protocol") ?? existingData?.protocol);
  const driver = readStringField(body, "driver") ?? existingData?.driver ?? "";
  const criAddress = readStringField(body, "criAddress") ?? existingData?.criAddress ?? "";
  const customLabels = body?.labels && typeof body.labels === "object" && !Array.isArray(body.labels)
    ? Object.fromEntries(Object.entries(body.labels).map(([key, value]) => [key.trim(), String(value).trim()]).filter(([key]) => key))
    : parseJsonField<Record<string, string>>(existingData?.labelsJson, {});
  const labels = { ...customLabels, ...blueedgeNodeLabels };
  const status = existingData?.status && accessConfigStatuses.has(existingData.status) ? existingData.status : "pending";
  const createdAt = existingData?.createdAt || new Date().toISOString();

  if (!name || !nodeName || !edgeUnitRef || !kubeEdgeVersion) {
    throw new Error("name, nodeName, edgeUnitRef and kubeEdgeVersion are required");
  }
  if (!isValidKubernetesName(name) || !isValidKubernetesName(nodeName)) {
    throw new Error("name and nodeName must be valid Kubernetes resource names");
  }
  if (os !== "linux") {
    throw new Error("os must be linux");
  }
  if (!protocol) {
    throw new Error("protocol must be one of https, websocket, quic");
  }
  if (driver && !accessConfigDrivers.has(driver)) {
    throw new Error("driver must be one of systemd, cgroups");
  }
  if (criAddress && !/^(?:unix:\/\/)?\/[A-Za-z0-9._/-]+$/.test(criAddress)) {
    throw new Error("criAddress must be an absolute Unix socket endpoint");
  }
  if (!cloudCoreAddress || !isHostPort(cloudCoreAddress)) {
    throw new Error("cloudCoreAddress must be a valid host:port");
  }

  return {
    name,
    edgeUnitRef,
    // NodeGroup is an EdgeApplication deployment target, not a node ownership field.
    // Keep the serialized field empty so older clients can continue reading the shape
    // without implicitly coupling an AccessConfig to the EdgeUnit's NodeGroup.
    nodeGroupRef: "",
    nodeName,
    architecture,
    os,
    kubeEdgeVersion,
    cloudCoreAddress,
    protocol,
    driver,
    criAddress,
    registry: readStringField(body, "registry") ?? existingData?.registry ?? "",
    description: readStringField(body, "description") ?? existingData?.description ?? "",
    labelsJson: JSON.stringify(labels),
    status,
    createdAt,
  };
}

function buildAccessConfigMap(body: any, existing?: any, options: { allowNodeName?: boolean } = {}) {
  const existingMetadata = metadataOf(existing);
  const data = buildAccessConfigData(body, dataOf(existing), options);
  return {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      ...(existingMetadata.resourceVersion ? { resourceVersion: existingMetadata.resourceVersion } : {}),
      name: existingMetadata.name || accessConfigResourceName(data.name),
      namespace: blueedgeNamespace(),
      labels: {
        ...(existingMetadata.labels || {}),
        [blueedgeResourceLabel]: accessConfigResourceValue,
        [accessConfigNameLabel]: data.name,
      },
    },
    data,
  };
}

function accessConfigMatches(configMap: any, name: string): boolean {
  const data = dataOf(configMap);
  const labels = labelsOf(configMap);
  const metadata = metadataOf(configMap);
  return data.name === name || labels[accessConfigNameLabel] === name || metadata.name === accessConfigResourceName(name);
}

function isValidAccessConfigMap(configMap: any, warnings: EdgeUnitWarning[]): boolean {
  const data = dataOf(configMap);
  if (data.name && data.edgeUnitRef && data.nodeName && data.kubeEdgeVersion) return true;
  warnings.push({
    source: "access-config.configmap",
    message: `Invalid AccessConfig ConfigMap ${metadataOf(configMap).namespace || blueedgeNamespace()}/${metadataOf(configMap).name || "-"}: missing required data fields`,
  });
  return false;
}

function buildAccessConfigView(configMap: any, nodes: any[]) {
  const metadata = metadataOf(configMap);
  const data = dataOf(configMap);
  const node = nodeByName(nodes, data.nodeName);
  const registered = Boolean(node);
  const ready = node ? isNodeReady(node) : false;
  const status = !registered ? "pending" : ready ? "ready" : "abnormal";

  return {
    name: data.name,
    edgeUnitRef: data.edgeUnitRef,
    nodeGroupRef: data.nodeGroupRef,
    nodeName: data.nodeName,
    architecture: data.architecture || "auto",
    os: data.os || "linux",
    kubeEdgeVersion: data.kubeEdgeVersion,
    cloudCoreAddress: data.cloudCoreAddress || "",
    protocol: data.protocol || "https",
    driver: accessConfigDrivers.has(data.driver) ? data.driver : "",
    criAddress: data.criAddress || "",
    registry: data.registry || "",
    labels: parseJsonField<Record<string, string>>(data.labelsJson, {}),
    status,
    registered,
    ready,
    createdAt: data.createdAt || metadata.creationTimestamp || "",
    description: data.description || "",
  };
}

async function getAccessConfigMaps(warnings: EdgeUnitWarning[]): Promise<any[]> {
  return listByResourceLabel(accessConfigResourceValue).catch((error) => {
    warnings.push({ source: "access-config.configmap", message: error instanceof Error ? error.message : "AccessConfig ConfigMap list unavailable" });
    return [];
  });
}

async function collectAccessConfigSources(warnings: EdgeUnitWarning[]) {
  const [configMaps, nodes] = await Promise.all([
    getAccessConfigMaps(warnings),
    getEdgeUnitNodes(warnings),
  ]);
  return { configMaps, nodes };
}

async function syncRegisteredNodeLabels(configMaps: any[], nodes: any[], warnings: EdgeUnitWarning[]) {
  const registeredNames = new Set(nodes.map((node) => String(metadataOf(node).name || "")).filter(Boolean));
  for (const configMap of configMaps) {
    if (!isValidAccessConfigMap(configMap, warnings)) continue;
    const data = dataOf(configMap);
    const nodeName = String(data.nodeName || "");
    if (!nodeName || !registeredNames.has(nodeName)) continue;
    const desiredLabels = {
      ...parseJsonField<Record<string, string>>(data.labelsJson, {}),
      ...blueedgeNodeLabels,
      ...(data.edgeUnitRef ? { "blueedge.io/edge-unit": data.edgeUnitRef } : {}),
    };
    try {
      const path = `/api/v1/nodes/${encodeURIComponent(nodeName)}`;
      const node = await getK8sJson(path);
      const currentLabels = labelsOf(node);
      if (Object.entries(desiredLabels).every(([key, value]) => currentLabels[key] === value)) continue;
      node.metadata = { ...(node.metadata || {}), labels: { ...currentLabels, ...desiredLabels } };
      await requestK8sJson(path, { method: "PUT", body: node });
    } catch (error) {
      warnings.push({ source: "access-config.node-labels", message: `Node ${nodeName} 的 BlueEdge 标签同步失败：${error instanceof Error ? error.message : "unknown error"}` });
    }
  }
}

function validationError(error: unknown, fallback: string) {
  return { status: 400, body: { message: error instanceof Error ? error.message : fallback } };
}

function decodeJoinToken(secret: any): string {
  const encoded = secret?.data?.[config.kubeEdgeTokenSecretKey];
  if (typeof encoded !== "string" || !encoded) {
    throw new Error(`Secret ${config.kubeEdgeTokenSecretNamespace}/${config.kubeEdgeTokenSecretName} does not contain ${config.kubeEdgeTokenSecretKey}`);
  }
  const token = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (!token) throw new Error("KubeEdge join token is empty");
  return token;
}

function tokenExpiresAt(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[2], "base64url").toString("utf8"));
    return typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

async function getKubeEdgeJoinToken() {
  const namespace = encodeURIComponent(config.kubeEdgeTokenSecretNamespace);
  const name = encodeURIComponent(config.kubeEdgeTokenSecretName);
  const secret = await getK8sJson(`/api/v1/namespaces/${namespace}/secrets/${name}`);
  const token = decodeJoinToken(secret);
  const expiresAt = tokenExpiresAt(token);
  if (!expiresAt) throw new Error("KubeEdge join token has an unsupported format or no expiration time");
  if (Date.parse(expiresAt) - Date.now() <= config.kubeEdgeTokenMinValiditySeconds * 1000) {
    throw new Error(`KubeEdge join token expires too soon at ${expiresAt}`);
  }
  return { token, expiresAt };
}

function normalizeVersion(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

export function buildPrepareCommand(version: string): string {
  const normalizedVersion = normalizeVersion(version);
  return [
    "set -euo pipefail",
    'machine_arch="$(uname -m)"',
    'case "$machine_arch" in',
    '  x86_64|amd64) keadm_arch="amd64" ;;',
    '  aarch64|arm64) keadm_arch="arm64" ;;',
    '  armv7l|armv6l|arm) keadm_arch="arm" ;;',
    '  *) echo "Unsupported system architecture: $machine_arch" >&2; exit 1 ;;',
    "esac",
    `archive="keadm-${normalizedVersion}-linux-\${keadm_arch}.tar.gz"`,
    `download_url="https://github.com/kubeedge/kubeedge/releases/download/${normalizedVersion}/\${archive}"`,
    'workdir="$(mktemp -d)"',
    'curl -fL "$download_url" -o "$workdir/$archive"',
    'tar -xzf "$workdir/$archive" -C "$workdir"',
    'keadm_bin="$(find "$workdir" -type f -name keadm -print -quit)"',
    'test -n "$keadm_bin"',
    'install -m 0755 "$keadm_bin" /usr/local/bin/keadm',
    'rm -rf "$workdir"',
    "keadm version",
  ].join("\n");
}

export function buildJoinCommand(item: ReturnType<typeof buildAccessConfigView>, token: string, nodeName = item.nodeName): string {
  const runtimeEndpoint = item.criAddress
    ? item.criAddress.includes("://") ? item.criAddress : `unix://${item.criAddress}`
    : "";
  return [
    "keadm join",
    `  --cloudcore-ipport=${item.cloudCoreAddress}`,
    `  --token=${token}`,
    `  --kubeedge-version=${normalizeVersion(item.kubeEdgeVersion)}`,
    ...(nodeName ? [`  --edgenode-name=${nodeName}`] : []),
    `  --labels=blueedge.io/managed-by=blueedge,blueedge.io/node-role=edge,blueedge.io/edge-unit=${item.edgeUnitRef}`,
    ...(item.protocol === "websocket" || item.protocol === "quic" ? [`  --hub-protocol=${item.protocol}`] : []),
    ...(runtimeEndpoint ? [`  --remote-runtime-endpoint=${runtimeEndpoint}`] : []),
    ...(item.driver ? [`  --cgroupdriver=${item.driver === "cgroups" ? "cgroupfs" : "systemd"}`] : []),
    ...(item.registry ? [`  --image-repository=${item.registry}`] : []),
  ].join(" \\\n");
}

export async function listAccessConfigs() {
  const warnings: EdgeUnitWarning[] = [];
  const { configMaps, nodes } = await collectAccessConfigSources(warnings);
  const items = configMaps
    .filter((configMap) => isValidAccessConfigMap(configMap, warnings))
    .map((configMap) => buildAccessConfigView(configMap, nodes));
  return { items, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function getAccessConfig(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const { configMaps, nodes } = await collectAccessConfigSources(warnings);
  const configMap = configMaps.find((item) => accessConfigMatches(item, name));
  if (!configMap || !isValidAccessConfigMap(configMap, warnings)) {
    return { status: 404, body: { message: `AccessConfig ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  return { status: 200, body: { item: buildAccessConfigView(configMap, nodes), ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function createAccessConfig(body: any) {
  const warnings: EdgeUnitWarning[] = [];
  const name = readStringField(body, "name") || "";
  const edgeUnitRef = readStringField(body, "edgeUnitRef") || "";
  if (!name || !edgeUnitRef) {
    return { status: 400, body: { message: "name and edgeUnitRef are required" } };
  }
  const existing = (await getAccessConfigMaps(warnings)).find((item) => accessConfigMatches(item, name));
  if (existing) {
    return { status: 409, body: { message: `AccessConfig ${name} already exists`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const edgeUnit = await resolveEdgeUnitReference(edgeUnitRef, warnings);
  if (!edgeUnit) {
    return { status: 400, body: { message: `EdgeUnit ${edgeUnitRef} does not exist`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  if (!edgeUnit.kubeEdgeVersion || edgeUnit.kubeEdgeVersion === "unknown") {
    return { status: 400, body: { message: `EdgeUnit ${edgeUnitRef} does not have a configured KubeEdge version`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  let configMap;
  try {
    configMap = buildAccessConfigMap({
      ...body,
      cloudCoreAddress: resolveAccessConfigCloudCoreAddress(body, edgeUnit),
      kubeEdgeVersion: edgeUnit.kubeEdgeVersion,
    });
  } catch (error) {
    return validationError(error, "Invalid EdgeUnit payload");
  }

  await ensureNamespace();
  const created = await create(configMap);
  const nodes = await getEdgeUnitNodes(warnings);
  await syncRegisteredNodeLabels([created], nodes, warnings);
  return { status: 201, body: { item: buildAccessConfigView(created, nodes), ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function updateAccessConfig(name: string, body: any) {
  const warnings: EdgeUnitWarning[] = [];
  if (Object.prototype.hasOwnProperty.call(body || {}, "name") ||
    Object.prototype.hasOwnProperty.call(body || {}, "status") ||
    Object.prototype.hasOwnProperty.call(body || {}, "registered") ||
    Object.prototype.hasOwnProperty.call(body || {}, "ready") ||
    Object.prototype.hasOwnProperty.call(body || {}, "createdAt")) {
    return { status: 400, body: { message: "name, status, registered, ready and createdAt are immutable" } };
  }

  const { configMaps, nodes } = await collectAccessConfigSources(warnings);
  const existing = configMaps.find((item) => accessConfigMatches(item, name));
  if (!existing || !isValidAccessConfigMap(existing, warnings)) {
    return { status: 404, body: { message: `AccessConfig ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  const existingView = buildAccessConfigView(existing, nodes);
  if (existingView.registered && (Object.prototype.hasOwnProperty.call(body || {}, "nodeName") || Object.prototype.hasOwnProperty.call(body || {}, "edgeUnitRef"))) {
    return { status: 400, body: { message: "nodeName and edgeUnitRef cannot be changed after the node is registered" } };
  }

  const nextEdgeUnitRef = readStringField(body, "edgeUnitRef") || dataOf(existing).edgeUnitRef;
  const edgeUnit = await resolveEdgeUnitReference(nextEdgeUnitRef, warnings);
  if (!edgeUnit) {
    return { status: 400, body: { message: `EdgeUnit ${nextEdgeUnitRef} does not exist`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  if (!edgeUnit.kubeEdgeVersion || edgeUnit.kubeEdgeVersion === "unknown") {
    return { status: 400, body: { message: `EdgeUnit ${nextEdgeUnitRef} does not have a configured KubeEdge version`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }

  let configMap;
  try {
    configMap = buildAccessConfigMap({ ...body, kubeEdgeVersion: edgeUnit.kubeEdgeVersion }, existing, { allowNodeName: !existingView.registered });
  } catch (error) {
    return validationError(error, "Invalid EdgeUnit payload");
  }

  const updated = await update(metadataOf(existing).name, configMap);
  await syncRegisteredNodeLabels([updated], nodes, warnings);
  return { status: 200, body: { item: buildAccessConfigView(updated, nodes), ...(warnings.length > 0 ? { warnings } : {}) } };
}

export async function deleteAccessConfig(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const { configMaps, nodes } = await collectAccessConfigSources(warnings);
  const existing = configMaps.find((item) => accessConfigMatches(item, name));
  if (!existing) {
    return { status: 404, body: { message: `AccessConfig ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const view = buildAccessConfigView(existing, nodes);
  await remove(metadataOf(existing).name);
  return {
    status: 200,
    body: {
      warnings: [
        ...warnings,
        {
          source: "access-config.delete",
          message: view.registered
            ? `AccessConfig ${view.name} metadata deleted. Registered Node ${view.nodeName} is retained and edgecore is not stopped.`
            : `AccessConfig ${view.name} metadata deleted. No Kubernetes Node was deleted.`,
        },
      ],
    },
  };
}

export async function getInstallCommand(name: string, nodeNameOverride: string | null = null) {
  const warnings: EdgeUnitWarning[] = [];
  const { configMaps, nodes } = await collectAccessConfigSources(warnings);
  const configMap = configMaps.find((item) => accessConfigMatches(item, name));
  if (!configMap || !isValidAccessConfigMap(configMap, warnings)) {
    return { status: 404, body: { message: `AccessConfig ${name} not found`, ...(warnings.length > 0 ? { warnings } : {}) } };
  }
  const item = buildAccessConfigView(configMap, nodes);
  const nodeName = nodeNameOverride === null ? item.nodeName : nodeNameOverride.trim();
  if (nodeName && !isValidKubernetesName(nodeName)) {
    return { status: 400, body: { message: "nodeName must be a valid Kubernetes resource name" } };
  }
  const commandTemplate = buildJoinCommand(item, "<short-lived-token>", nodeName);
  const prepareCommand = buildPrepareCommand(item.kubeEdgeVersion);
  try {
    const { token, expiresAt } = await getKubeEdgeJoinToken();
    return {
      status: 200,
      body: {
        name: item.name,
        ready: true,
        prepareCommand,
        command: buildJoinCommand(item, token, nodeName),
        commandTemplate,
        missingRequirements: [],
        expiresAt,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  } catch (error) {
    warnings.push({
      source: "access-config.join-token",
      message: error instanceof Error ? error.message : "KubeEdge join token is unavailable",
    });
  }
  return {
    status: 200,
    body: {
      name: item.name,
      ready: false,
      prepareCommand,
      command: "",
      commandTemplate,
      missingRequirements: ["KubeEdge join token is unavailable or expires too soon"],
      expiresAt: null,
      warnings,
    },
  };
}

export async function listAccessConfigViewsForNodes(warnings: EdgeUnitWarning[], nodes: any[]) {
  const configMaps = await getAccessConfigMaps(warnings);
  return configMaps
    .filter((item) => isValidAccessConfigMap(item, warnings))
    .map((item) => buildAccessConfigView(item, nodes));
}
