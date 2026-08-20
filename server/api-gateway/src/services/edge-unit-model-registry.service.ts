import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { getK8sJson } from "../clients/k8s-client.js";
import {
  blueedgeNamespace,
  update,
} from "../repositories/blueedge-configmap.repository.js";
import { dataOf, metadataOf } from "../utils/kubernetes.js";
import { isValidKubernetesName } from "../utils/validation.js";
import {
  edgeUnitConfigMapMatches,
  getEdgeUnitConfigMaps,
} from "./edge-unit-source.service.js";

const dataKeys = {
  enabled: "modelRegistryEnabled",
  host: "modelRegistryHost",
  prefix: "modelRegistryRepositoryPrefix",
  tls: "modelRegistryTls",
  pullSecret: "modelRegistryPullSecretName",
  readCredentialRef: "modelRegistryReadCredentialRef",
  legacyCredentialRef: "modelRegistryCredentialRef",
  caSecretRef: "modelRegistryCaSecretRef",
} as const;

export type EdgeUnitModelRegistry = {
  enabled: boolean;
  registryHost: string;
  repositoryPrefix: string;
  tls: boolean;
  // Pod/container runtime authentication. This Secret lives in the model
  // Deployment namespace and is never used by the api-gateway Registry client.
  pullSecretName: string;
  // BlueEdge api-gateway read-only catalog/tags/manifest authentication.
  // BAMS promotion credentials belong to BAMS and must never use this Secret.
  readCredentialRef: string;
  // BlueEdge api-gateway HTTPS trust only. BAMS promotion and edge-container
  // runtimes maintain their own independent Registry CA trust.
  caSecretRef: string;
};

export type RegistryCredential =
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string };

export type RegistryCa = { pem: string };

type RegistryDependencies = {
  listEdgeUnits(): Promise<any[]>;
  updateEdgeUnit(configMapName: string, resource: any): Promise<any>;
  getSecret(namespace: string, name: string): Promise<any>;
};

const productionDependencies: RegistryDependencies = {
  listEdgeUnits: () => getEdgeUnitConfigMaps([]),
  updateEdgeUnit: update,
  getSecret(namespace, name) {
    return getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`);
  },
};

function requiredBoolean(value: unknown, field: string): boolean {
  if (value === true || value === false) return value;
  throw new Error(`${field} must be a boolean`);
}

export function normalizeRegistryHost(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("registryHost is required");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("registryHost is invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || !parsed.hostname) {
    throw new Error("registryHost must contain only a registry hostname and optional port");
  }
  const hostname = parsed.hostname.toLowerCase();
  const validHostname = hostname === "localhost"
    || (/^[a-z0-9.-]+$/.test(hostname)
      && !hostname.includes("..")
      && hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))
    || (/^\[[0-9a-f:.]+\]$/i.test(hostname));
  if (!validHostname) throw new Error("registryHost hostname is invalid");
  const port = parsed.port ? Number(parsed.port) : 0;
  if (parsed.port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("registryHost port is invalid");
  }
  return parsed.host.toLowerCase();
}

export function normalizeRepositoryPrefix(value: unknown): string {
  const prefix = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!prefix) throw new Error("repositoryPrefix is required");
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(prefix) || prefix.includes("..")) {
    throw new Error("repositoryPrefix is invalid");
  }
  return prefix;
}

function optionalKubernetesName(value: unknown, field: string): string {
  const name = String(value ?? "").trim();
  if (name && !isValidKubernetesName(name)) throw new Error(`${field} must be a valid Kubernetes Secret name`);
  return name;
}

export function normalizeEdgeUnitModelRegistry(body: any): EdgeUnitModelRegistry {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("model registry payload must be an object");
  for (const sensitiveField of ["username", "password", "token", "dockerconfigjson", ".dockerconfigjson"]) {
    if (Object.prototype.hasOwnProperty.call(body, sensitiveField)) {
      throw new Error(`${sensitiveField} must be stored in a Kubernetes Secret and referenced by readCredentialRef`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "credentialRef")) {
    throw new Error("credentialRef has been replaced by readCredentialRef");
  }
  const tlsEnabled = requiredBoolean(body.tls, "tls");
  const caSecretRef = optionalKubernetesName(body.caSecretRef, "caSecretRef");
  if (!tlsEnabled && caSecretRef) throw new Error("caSecretRef requires tls=true");
  return {
    enabled: requiredBoolean(body.enabled, "enabled"),
    registryHost: normalizeRegistryHost(body.registryHost),
    repositoryPrefix: normalizeRepositoryPrefix(body.repositoryPrefix),
    tls: tlsEnabled,
    pullSecretName: optionalKubernetesName(body.pullSecretName, "pullSecretName"),
    readCredentialRef: optionalKubernetesName(body.readCredentialRef, "readCredentialRef"),
    caSecretRef,
  };
}

export function modelRegistryData(config: EdgeUnitModelRegistry): Record<string, string> {
  return {
    [dataKeys.enabled]: String(config.enabled),
    [dataKeys.host]: config.registryHost,
    [dataKeys.prefix]: config.repositoryPrefix,
    [dataKeys.tls]: String(config.tls),
    [dataKeys.pullSecret]: config.pullSecretName,
    [dataKeys.readCredentialRef]: config.readCredentialRef,
    [dataKeys.caSecretRef]: config.caSecretRef,
  };
}

export function modelRegistryFromData(data: Record<string, string>): EdgeUnitModelRegistry | null {
  if (!Object.prototype.hasOwnProperty.call(data, dataKeys.enabled)) return null;
  const readCredentialRef = Object.prototype.hasOwnProperty.call(data, dataKeys.readCredentialRef)
    ? data[dataKeys.readCredentialRef]
    : data[dataKeys.legacyCredentialRef];
  return normalizeEdgeUnitModelRegistry({
    enabled: data[dataKeys.enabled] === "true",
    registryHost: data[dataKeys.host],
    repositoryPrefix: data[dataKeys.prefix],
    tls: data[dataKeys.tls] === "true",
    pullSecretName: data[dataKeys.pullSecret] || "",
    readCredentialRef: readCredentialRef || "",
    caSecretRef: data[dataKeys.caSecretRef] || "",
  });
}

function decodeSecretValue(secret: any, key: string): string {
  const encoded = secret?.data?.[key];
  if (typeof encoded !== "string" || !encoded) return "";
  try {
    return Buffer.from(encoded, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

export function registryCredentialFromSecret(secret: any): RegistryCredential | null {
  const token = decodeSecretValue(secret, "token");
  if (token) return { type: "bearer", token };
  const username = decodeSecretValue(secret, "username");
  const password = decodeSecretValue(secret, "password");
  return username && password ? { type: "basic", username, password } : null;
}

async function findEdgeUnit(name: string, dependencies: RegistryDependencies): Promise<any | null> {
  return (await dependencies.listEdgeUnits()).find((item) => edgeUnitConfigMapMatches(item, name)) || null;
}

async function credentialConfigured(config: EdgeUnitModelRegistry, dependencies: RegistryDependencies): Promise<boolean> {
  if (!config.readCredentialRef) return false;
  try {
    const secret = await dependencies.getSecret(blueedgeNamespace(), config.readCredentialRef);
    return registryCredentialFromSecret(secret) !== null;
  } catch {
    return false;
  }
}

export function registryCaFromSecret(secret: any): RegistryCa | null {
  const pem = decodeSecretValue(secret, "ca.crt");
  if (!pem) return null;
  try {
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!certificates?.length) return null;
    for (const certificate of certificates) new X509Certificate(certificate);
    tls.createSecureContext({ ca: pem });
    return { pem };
  } catch {
    return null;
  }
}

async function caConfigured(config: EdgeUnitModelRegistry, dependencies: RegistryDependencies): Promise<boolean> {
  if (!config.caSecretRef) return false;
  try {
    const secret = await dependencies.getSecret(blueedgeNamespace(), config.caSecretRef);
    return registryCaFromSecret(secret) !== null;
  } catch {
    return false;
  }
}

export async function getEdgeUnitModelRegistryWithDependencies(name: string, dependencies: RegistryDependencies) {
  const edgeUnit = await findEdgeUnit(name, dependencies);
  if (!edgeUnit) return { status: 404, body: { message: `EdgeUnit ${name} not found` } };
  const config = modelRegistryFromData(dataOf(edgeUnit));
  if (!config) return { status: 404, body: { message: `EdgeUnit ${name} model Registry is not configured` } };
  return {
    status: 200,
    body: {
      enabled: config.enabled,
      registryHost: config.registryHost,
      repositoryPrefix: config.repositoryPrefix,
      tls: config.tls,
      pullSecretName: config.pullSecretName,
      credentialConfigured: await credentialConfigured(config, dependencies),
      caConfigured: await caConfigured(config, dependencies),
    },
  };
}

export async function putEdgeUnitModelRegistryWithDependencies(name: string, body: any, dependencies: RegistryDependencies) {
  const edgeUnit = await findEdgeUnit(name, dependencies);
  if (!edgeUnit) return { status: 404, body: { message: `EdgeUnit ${name} not found` } };
  let config: EdgeUnitModelRegistry;
  try {
    config = normalizeEdgeUnitModelRegistry(body);
  } catch (error) {
    return { status: 400, body: { message: error instanceof Error ? error.message : "Invalid model Registry configuration" } };
  }
  try {
    await readEdgeUnitRegistryCaWithDependencies(config, dependencies);
  } catch (error) {
    return { status: 400, body: { message: error instanceof Error ? error.message : "Invalid Registry CA configuration" } };
  }
  const updated = structuredClone(edgeUnit);
  updated.data = { ...dataOf(edgeUnit), ...modelRegistryData(config) };
  delete updated.data[dataKeys.legacyCredentialRef];
  const saved = await dependencies.updateEdgeUnit(String(metadataOf(edgeUnit).name || ""), updated);
  const savedConfig = modelRegistryFromData(dataOf(saved)) || config;
  return {
    status: 200,
    body: {
      enabled: savedConfig.enabled,
      registryHost: savedConfig.registryHost,
      repositoryPrefix: savedConfig.repositoryPrefix,
      tls: savedConfig.tls,
      pullSecretName: savedConfig.pullSecretName,
      credentialConfigured: await credentialConfigured(savedConfig, dependencies),
      caConfigured: await caConfigured(savedConfig, dependencies),
    },
  };
}

export function getEdgeUnitModelRegistry(name: string) {
  return getEdgeUnitModelRegistryWithDependencies(name, productionDependencies);
}

export function putEdgeUnitModelRegistry(name: string, body: any) {
  return putEdgeUnitModelRegistryWithDependencies(name, body, productionDependencies);
}

export async function resolveEdgeUnitModelRegistry(name: string): Promise<EdgeUnitModelRegistry> {
  const edgeUnit = await findEdgeUnit(name, productionDependencies);
  if (!edgeUnit) throw new Error(`EdgeUnit ${name} not found`);
  const registry = modelRegistryFromData(dataOf(edgeUnit));
  if (!registry) throw new Error(`EdgeUnit ${name} model Registry is not configured`);
  if (!registry.enabled) throw new Error(`EdgeUnit ${name} model Registry is disabled`);
  return registry;
}

export async function readEdgeUnitRegistryCredential(config: EdgeUnitModelRegistry): Promise<RegistryCredential | null> {
  if (!config.readCredentialRef) return null;
  let secret: any;
  try {
    secret = await productionDependencies.getSecret(blueedgeNamespace(), config.readCredentialRef);
  } catch (error) {
    throw new Error(`Registry read credential Secret ${config.readCredentialRef} is missing: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const credential = registryCredentialFromSecret(secret);
  if (!credential) throw new Error(`Registry read credential Secret ${config.readCredentialRef} must contain token or username/password`);
  return credential;
}

export async function readEdgeUnitRegistryCaWithDependencies(
  config: EdgeUnitModelRegistry,
  dependencies: Pick<RegistryDependencies, "getSecret">,
): Promise<RegistryCa | null> {
  if (!config.tls || !config.caSecretRef) return null;
  let secret: any;
  try {
    secret = await dependencies.getSecret(blueedgeNamespace(), config.caSecretRef);
  } catch (error) {
    throw new Error(`Registry CA Secret ${config.caSecretRef} is missing: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const ca = registryCaFromSecret(secret);
  if (!ca) throw new Error(`Registry CA Secret ${config.caSecretRef} must contain a valid ca.crt certificate`);
  return ca;
}

export function readEdgeUnitRegistryCa(config: EdgeUnitModelRegistry): Promise<RegistryCa | null> {
  return readEdgeUnitRegistryCaWithDependencies(config, productionDependencies);
}
