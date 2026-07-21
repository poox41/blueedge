import { getK8sJson } from "../clients/k8s-client.js";
import type { DeviceSummarySources } from "../types/device.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  annotationsOf,
  explicitNodeNamesOf,
  itemsOf,
  labelsOf,
  metadataOf,
  nodeByName,
  nodeGroupSelectorOf,
  nodeMatchesSelector,
  warning,
} from "../utils/kubernetes.js";
import {
  collectNodeGroupDetails,
  getEdgeUnitNodes,
} from "./edge-unit-source.service.js";
import { getDeviceExtensionConfig } from "./device-config.service.js";

const deviceCrdBasePath = "/apis/devices.kubeedge.io/v1beta1";
const sensitiveFieldPattern = /(password|passwd|token|secret|credential|privatekey|private-key|cert|certificate|username|userName)/i;

function namespacePath(namespace?: string) {
  return namespace ? `/namespaces/${encodeURIComponent(namespace)}` : "";
}

function deviceModelListPath(namespace?: string) {
  return `${deviceCrdBasePath}${namespacePath(namespace)}/devicemodels`;
}

function deviceListPath(namespace?: string) {
  return `${deviceCrdBasePath}${namespacePath(namespace)}/devices`;
}

async function getDeviceModelsFromK8s(namespace?: string): Promise<any[]> {
  return itemsOf(await getK8sJson(deviceModelListPath(namespace)));
}

async function getDevicesFromK8s(namespace?: string): Promise<any[]> {
  return itemsOf(await getK8sJson(deviceListPath(namespace)));
}

async function getDeviceModelFromK8s(namespace: string, name: string): Promise<any> {
  return getK8sJson(`${deviceModelListPath(namespace)}/${encodeURIComponent(name)}`);
}

async function getDeviceFromK8s(namespace: string, name: string): Promise<any> {
  return getK8sJson(`${deviceListPath(namespace)}/${encodeURIComponent(name)}`);
}

function sanitizeSensitive(value: any): any {
  if (Array.isArray(value)) return value.map(sanitizeSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveFieldPattern.test(key) ? "***" : sanitizeSensitive(item),
  ]));
}

function objectValue(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value !== undefined && value !== null && typeof value !== "object") {
      const next = String(value).trim();
      if (next) return next;
    }
  }
  return "";
}

function readProtocol(value: any): string {
  const protocol = value?.spec?.protocol ?? value?.protocol;
  if (typeof protocol === "string") return protocol || "unknown";
  if (protocol && typeof protocol === "object") {
    return firstString(protocol.protocolName, protocol.name, protocol.type, protocol.protocol) || "unknown";
  }
  const labels = labelsOf(value);
  const annotations = annotationsOf(value);
  return firstString(labels.protocol, annotations.protocol, labels["blueedge.io/protocol"], annotations["blueedge.io/protocol"]) || "unknown";
}

function deviceModelName(model: any): string {
  return String(metadataOf(model).name || model?.name || "");
}

function resourceNamespace(resource: any): string {
  return String(metadataOf(resource).namespace || resource?.namespace || "default");
}

function normalizeDeviceModelProperties(model: any) {
  const rawProperties =
    model?.spec?.properties ||
    model?.spec?.deviceProperties ||
    model?.spec?.propertyVisitors ||
    model?.properties ||
    [];
  if (!Array.isArray(rawProperties)) return [];
  return rawProperties.map((item: any, index) => ({
    name: firstString(item?.name, item?.propertyName) || `property-${index + 1}`,
    type: firstString(item?.type, item?.dataType, item?.propertyType) || "unknown",
    accessMode: firstString(item?.accessMode, item?.access, item?.mode) || "unknown",
    unit: firstString(item?.unit),
    minimum: item?.minimum ?? item?.min ?? null,
    maximum: item?.maximum ?? item?.max ?? null,
    defaultValue: item?.defaultValue ?? item?.default ?? null,
    description: firstString(item?.description),
  }));
}

function deviceModelRefOf(device: any): string {
  const ref = device?.spec?.deviceModelRef ?? device?.deviceModelRef ?? device?.model;
  if (typeof ref === "string") return ref;
  return firstString(ref?.name, ref?.modelName);
}

function deviceNodeNameOf(device: any): string {
  const labels = labelsOf(device);
  const annotations = annotationsOf(device);
  return firstString(
    device?.spec?.nodeName,
    device?.nodeName,
    labels["blueedge.io/node"],
    annotations["blueedge.io/node"],
    labels["kubeedge.io/node"],
    annotations["kubeedge.io/node"],
    device?.spec?.mapper?.nodeName,
    device?.spec?.protocol?.nodeName,
  );
}

function deviceMatchesModel(device: any, model: any): boolean {
  return resourceNamespace(device) === resourceNamespace(model) && deviceModelRefOf(device) === deviceModelName(model);
}

export function normalizeDeviceStatus(device: any): "online" | "offline" {
  const status = device?.status;
  const candidates = [
    status?.state,
    status?.status,
    status?.phase,
    status?.deviceStatus,
    status?.connectionStatus,
    status?.online,
    device?.status,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || typeof candidate === "object") continue;
    const value = String(candidate).toLowerCase();
    if (["online", "connected", "ready", "healthy", "true"].includes(value)) return "online";
    if (["offline", "disconnected", "unavailable", "notready", "not ready", "false"].includes(value)) return "offline";
  }
  return "offline";
}

function normalizeTwinValue(value: any): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") {
    if ("value" in value) return normalizeTwinValue(value.value);
    if ("valueMetadata" in value) return normalizeTwinValue(value.valueMetadata);
    return JSON.stringify(sanitizeSensitive(value));
  }
  return String(value);
}

function normalizeDeviceTwins(device: any) {
  const rawTwins =
    device?.status?.twins ||
    device?.status?.deviceTwin ||
    device?.spec?.twins ||
    device?.spec?.properties ||
    device?.twins ||
    [];
  if (!Array.isArray(rawTwins)) return [];
  return rawTwins.map((item: any, index) => {
    const desiredValue = normalizeTwinValue(item?.desiredValue ?? item?.desired?.value ?? item?.desired ?? item?.expected ?? item?.expectedValue);
    const reportedValue = normalizeTwinValue(item?.reportedValue ?? item?.reported?.value ?? item?.reported ?? item?.actualValue ?? item?.actual);
    const status = desiredValue === null || reportedValue === null
      ? "unknown"
      : desiredValue === reportedValue
        ? "synced"
        : "outOfSync";
    return {
      name: firstString(item?.name, item?.propertyName) || `twin-${index + 1}`,
      propertyName: firstString(item?.propertyName, item?.name) || `twin-${index + 1}`,
      desiredValue: desiredValue ?? "",
      reportedValue: reportedValue ?? "",
      status,
      lastUpdatedAt: firstString(item?.lastUpdatedAt, item?.lastUpdateTime, item?.reported?.metadata?.timestamp),
      collectIntervalSeconds: Number(item?.collectCycle || 0),
      reportIntervalSeconds: Number(item?.reportCycle || 0),
      accessConfigured: Boolean(item?.visitors?.configData),
      metadata: sanitizeSensitive(objectValue(item?.metadata || item?.reported?.metadata || item?.desired?.metadata)),
    };
  });
}

export function summarizeTwins(twins: Array<{ status: string; lastUpdatedAt?: string }>, includeItems: boolean) {
  const lastReportedAt = twins
    .map((item) => item.lastUpdatedAt || "")
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] || "";
  return {
    total: twins.length,
    synced: twins.filter((item) => item.status === "synced").length,
    outOfSync: twins.filter((item) => item.status === "outOfSync").length,
    unknown: twins.filter((item) => item.status === "unknown").length,
    lastReportedAt,
    items: includeItems ? twins : [],
  };
}

function extractAccessConfig(device: any, protocol: string) {
  const source =
    device?.spec?.protocol ||
    device?.spec?.protocolConfig ||
    device?.spec?.configData ||
    device?.spec?.mapper ||
    {};
  const sanitized = sanitizeSensitive(objectValue(source));
  return {
    protocol,
    address: firstString(source.address, source.endpoint, source.broker, source.host),
    endpoint: firstString(source.endpoint, source.url, source.broker),
    metadata: sanitized,
  };
}

function nodeGroupForNode(nodeName: string, node: any | null, nodeGroups: any[]): string {
  if (!nodeName) return "";
  const matched = nodeGroups.find((group) => {
    if (explicitNodeNamesOf(group).includes(nodeName)) return true;
    return node ? nodeMatchesSelector(node, nodeGroupSelectorOf(group)) : false;
  });
  return matched ? String(metadataOf(matched).name || matched?.name || "") : "";
}

function directEdgeUnitRefOf(device: any): string {
  const labels = labelsOf(device);
  const annotations = annotationsOf(device);
  return firstString(labels["blueedge.io/edge-unit"], annotations["blueedge.io/edge-unit"]);
}

export function buildDeviceModelSummaryView(
  model: any,
  devices: any[],
  options: { includeRaw?: boolean; includeDeviceItems?: boolean } = {},
) {
  const namespace = resourceNamespace(model);
  const name = deviceModelName(model);
  const matchedDevices = devices.filter((device) => deviceMatchesModel(device, model));
  const statuses = matchedDevices.map(normalizeDeviceStatus);
  const annotations = annotationsOf(model);
  const view: any = {
    name,
    namespace,
    description: firstString(annotations["blueedge.io/description"], annotations.description, model?.description),
    protocol: readProtocol(model),
    properties: normalizeDeviceModelProperties(model),
    devices: {
      total: matchedDevices.length,
      online: statuses.filter((item) => item === "online").length,
      offline: statuses.filter((item) => item === "offline").length,
      unknown: 0,
      ...(options.includeDeviceItems ? {
        items: matchedDevices.map((device) => {
          const deviceAnnotations = annotationsOf(device);
          return {
            name: String(metadataOf(device).name || device?.name || ""),
            namespace: resourceNamespace(device),
            nodeName: deviceNodeNameOf(device),
            description: firstString(
              deviceAnnotations["blueedge.io/description"],
              deviceAnnotations.description,
              device?.description,
            ),
            status: normalizeDeviceStatus(device),
            lastReportedAt: summarizeTwins(normalizeDeviceTwins(device), false).lastReportedAt,
          };
        }),
      } : {}),
    },
    createdAt: metadataOf(model).creationTimestamp || model?.creationTimestamp || "",
    labels: labelsOf(model),
    annotations,
    rawRef: { kind: "DeviceModel", namespace, name },
  };
  if (options.includeRaw) view.raw = sanitizeSensitive(model);
  return view;
}

function buildDeviceSummaryView(
  device: any,
  sources: DeviceSummarySources,
  warnings: EdgeUnitWarning[],
  options: { includeRaw?: boolean; includeTwinItems?: boolean } = {},
) {
  const namespace = resourceNamespace(device);
  const name = String(metadataOf(device).name || device?.name || "");
  const deviceModelRef = deviceModelRefOf(device);
  const model = sources.deviceModels.find((item) => resourceNamespace(item) === namespace && deviceModelName(item) === deviceModelRef) || null;
  if (deviceModelRef && !model) {
    warnings.push({ source: "deviceModel", code: "not_found", message: `Referenced DeviceModel ${namespace}/${deviceModelRef} was not found` });
  }
  const nodeName = deviceNodeNameOf(device);
  const node = nodeName ? nodeByName(sources.nodes, nodeName) : null;
  if (nodeName && !node) {
    warnings.push({ source: "node", code: "not_found", message: `Referenced Node ${nodeName} was not found` });
  }
  const labels = labelsOf(device);
  const annotations = annotationsOf(device);
  const nodeGroupRef =
    firstString(labels["blueedge.io/nodegroup"], annotations["blueedge.io/nodegroup"], labels["blueedge.io/node-group"], annotations["blueedge.io/node-group"]) ||
    nodeGroupForNode(nodeName, node, sources.nodeGroups);
  const edgeUnitRef = directEdgeUnitRefOf(device) || firstString(
    labelsOf(node)["blueedge.io/edge-unit"],
    annotationsOf(node)["blueedge.io/edge-unit"],
  );
  const protocol = readProtocol(device) !== "unknown" ? readProtocol(device) : (model ? readProtocol(model) : "unknown");
  const twins = normalizeDeviceTwins(device);
  const view: any = {
    name,
    namespace,
    deviceModelRef,
    status: normalizeDeviceStatus(device),
    nodeName,
    edgeUnitRef,
    nodeGroupRef,
    protocol,
    access: extractAccessConfig(device, protocol),
    twins: summarizeTwins(twins, Boolean(options.includeTwinItems)),
    createdAt: metadataOf(device).creationTimestamp || device?.creationTimestamp || "",
    labels,
    annotations,
    rawRef: { kind: "Device", namespace, name },
  };
  if (options.includeRaw) view.raw = sanitizeSensitive(device);
  return view;
}

async function collectDeviceSummarySources(warnings: EdgeUnitWarning[], namespace?: string): Promise<DeviceSummarySources> {
  const [deviceModels, nodes, nodeGroups] = await Promise.all([
    getDeviceModelsFromK8s(namespace).catch((error) => {
      warnings.push(warning("deviceModel", error, "DeviceModel list unavailable"));
      return [];
    }),
    getEdgeUnitNodes(warnings).catch((error) => {
      warnings.push(warning("node", error, "Node list unavailable"));
      return [];
    }),
    collectNodeGroupDetails(warnings).then((result) => result.nodeGroups).catch((error) => {
      warnings.push(warning("nodegroup", error, "NodeGroup list unavailable"));
      return [];
    }),
  ]);
  return { deviceModels, nodes, nodeGroups };
}

export async function listDeviceModelSummaries(namespace?: string) {
  const warnings: EdgeUnitWarning[] = [];
  const deviceModels = await getDeviceModelsFromK8s(namespace);
  const devices = await getDevicesFromK8s(namespace).catch((error) => {
    warnings.push(warning("device", error, "Device list unavailable"));
    return [];
  });
  return {
    items: deviceModels.map((model) => buildDeviceModelSummaryView(model, devices)),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function getDeviceModelSummary(namespace: string, name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const model = await getDeviceModelFromK8s(namespace, name);
  const devices = await getDevicesFromK8s(namespace).catch((error) => {
    warnings.push(warning("device", error, "Device list unavailable"));
    return [];
  });
  return {
    item: buildDeviceModelSummaryView(model, devices, { includeRaw: true, includeDeviceItems: true }),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function listDeviceSummaries(options: { namespace?: string; nodeName?: string; edgeUnit?: string; deviceModel?: string }) {
  const warnings: EdgeUnitWarning[] = [];
  const devices = await getDevicesFromK8s(options.namespace);
  const sources = await collectDeviceSummarySources(warnings, options.namespace);
  const items = devices
    .map((device) => buildDeviceSummaryView(device, sources, warnings))
    .filter((item) => !options.nodeName || item.nodeName === options.nodeName)
    .filter((item) => !options.edgeUnit || item.edgeUnitRef === options.edgeUnit)
    .filter((item) => !options.deviceModel || item.deviceModelRef === options.deviceModel);

  return { items, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function getDeviceSummary(namespace: string, name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const device = await getDeviceFromK8s(namespace, name);
  const [sources, extension] = await Promise.all([
    collectDeviceSummarySources(warnings, namespace),
    getDeviceExtensionConfig(namespace, name).catch((error) => {
      warnings.push(warning("deviceExtension", error, "Device extension config unavailable"));
      return null;
    }),
  ]);
  const item = buildDeviceSummaryView(device, sources, warnings, { includeRaw: true, includeTwinItems: true });
  item.extension = extension;
  return {
    item,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
