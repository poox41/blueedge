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
import { getK8sJson } from "../clients/k8s-client.js";
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
const accessConfigArchitectures = new Set(["amd64", "arm64", "arm"]);
const accessConfigProtocols = new Set(["https", "websocket", "quic", "QUIC"]);
const accessConfigDrivers = new Set(["systemd", "cgroups"]);
const accessConfigStatuses = new Set(["pending", "registered", "ready", "abnormal", "expired", "unknown"]);

function accessConfigResourceName(name: string): string {
  return `access-config-${name}`;
}

function normalizeAccessConfigProtocol(value: string | undefined): string {
  if (!value) return "https";
  if (value === "QUIC") return "quic";
  return accessConfigProtocols.has(value) ? value : "";
}

function buildAccessConfigData(body: any, nodeGroupRef: string, existingData?: Record<string, string>, options: { allowNodeName?: boolean } = {}) {
  const name = readStringField(body, "name") || existingData?.name || "";
  const nodeName = options.allowNodeName === false ? existingData?.nodeName || "" : readStringField(body, "nodeName") || existingData?.nodeName || name;
  const edgeUnitRef = readStringField(body, "edgeUnitRef") || existingData?.edgeUnitRef || "";
  const architecture = readStringField(body, "architecture") || existingData?.architecture || "";
  const os = readStringField(body, "os") || existingData?.os || "linux";
  const kubeEdgeVersion = readStringField(body, "kubeEdgeVersion") || existingData?.kubeEdgeVersion || "";
  const cloudCoreAddress = readStringField(body, "cloudCoreAddress") || existingData?.cloudCoreAddress || "";
  const protocol = normalizeAccessConfigProtocol(readStringField(body, "protocol") ?? existingData?.protocol);
  const driver = readStringField(body, "driver") ?? existingData?.driver ?? "";
  const criAddress = readStringField(body, "criAddress") ?? existingData?.criAddress ?? "";
  const labels = body?.labels && typeof body.labels === "object" && !Array.isArray(body.labels)
    ? Object.fromEntries(Object.entries(body.labels).map(([key, value]) => [key.trim(), String(value).trim()]).filter(([key]) => key))
    : parseJsonField<Record<string, string>>(existingData?.labelsJson, {});
  const status = existingData?.status && accessConfigStatuses.has(existingData.status) ? existingData.status : "pending";
  const createdAt = existingData?.createdAt || new Date().toISOString();

  if (!name || !nodeName || !edgeUnitRef || !architecture || !kubeEdgeVersion) {
    throw new Error("name, nodeName, edgeUnitRef, architecture and kubeEdgeVersion are required");
  }
  if (!isValidKubernetesName(name) || !isValidKubernetesName(nodeName)) {
    throw new Error("name and nodeName must be valid Kubernetes resource names");
  }
  if (!accessConfigArchitectures.has(architecture)) {
    throw new Error("architecture must be one of amd64, arm64, arm");
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
  if (criAddress && !/^\/[A-Za-z0-9._/-]+$/.test(criAddress)) {
    throw new Error("criAddress must be an absolute Unix socket path");
  }
  if (!cloudCoreAddress || !isHostPort(cloudCoreAddress)) {
    throw new Error("cloudCoreAddress must be a valid host:port");
  }

  return {
    name,
    edgeUnitRef,
    nodeGroupRef,
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

function buildAccessConfigMap(body: any, nodeGroupRef: string, existing?: any, options: { allowNodeName?: boolean } = {}) {
  const existingMetadata = metadataOf(existing);
  const data = buildAccessConfigData(body, nodeGroupRef, dataOf(existing), options);
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
  if (data.name && data.edgeUnitRef && data.nodeName && data.architecture && data.kubeEdgeVersion) return true;
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
    architecture: data.architecture,
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

function buildPrepareCommand(version: string, architecture: string): string {
  const normalizedVersion = normalizeVersion(version);
  const archive = `keadm-${normalizedVersion}-linux-${architecture}.tar.gz`;
  const url = `https://github.com/kubeedge/kubeedge/releases/download/${normalizedVersion}/${archive}`;
  return [
    "set -euo pipefail",
    'workdir="$(mktemp -d)"',
    `curl -fL ${url} -o \"$workdir/${archive}\"`,
    `tar -xzf \"$workdir/${archive}\" -C \"$workdir\"`,
    'keadm_bin="$(find "$workdir" -type f -name keadm -print -quit)"',
    'test -n "$keadm_bin"',
    'install -m 0755 "$keadm_bin" /usr/local/bin/keadm',
    'rm -rf "$workdir"',
    "keadm version",
  ].join("\n");
}

function buildJoinCommand(item: ReturnType<typeof buildAccessConfigView>, token: string, nodeName = item.nodeName): string {
  const runtimeEndpoint = item.criAddress
    ? item.criAddress.includes("://") ? item.criAddress : `unix://${item.criAddress}`
    : "";
  return [
    "keadm join",
    `  --cloudcore-ipport=${item.cloudCoreAddress}`,
    `  --token=${token}`,
    `  --kubeedge-version=${normalizeVersion(item.kubeEdgeVersion)}`,
    ...(nodeName ? [`  --edgenode-name=${nodeName}`] : []),
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

  let configMap;
  try {
    configMap = buildAccessConfigMap(body, edgeUnit.nodeGroupRef);
  } catch (error) {
    return validationError(error, "Invalid EdgeUnit payload");
  }

  await ensureNamespace();
  const created = await create(configMap);
  const nodes = await getEdgeUnitNodes(warnings);
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

  let configMap;
  try {
    configMap = buildAccessConfigMap(body, edgeUnit.nodeGroupRef, existing, { allowNodeName: !existingView.registered });
  } catch (error) {
    return validationError(error, "Invalid EdgeUnit payload");
  }

  const updated = await update(metadataOf(existing).name, configMap);
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
  const prepareCommand = buildPrepareCommand(item.kubeEdgeVersion, item.architecture);
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
