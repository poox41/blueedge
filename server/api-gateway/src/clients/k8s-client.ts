import fs from "node:fs";
import { config } from "../config.js";

function readTokenFile(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function getServerK8sAuthorization(): string | undefined {
  if (config.k8sAuthHeader) return config.k8sAuthHeader;
  if (config.k8sToken) return `Bearer ${config.k8sToken}`;

  const tokenFile =
    config.k8sTokenFile ||
    (fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token")
      ? "/var/run/secrets/kubernetes.io/serviceaccount/token"
      : "");
  const token = tokenFile ? readTokenFile(tokenFile) : null;
  return token ? `Bearer ${token}` : undefined;
}

export function hasServerK8sAuthorization(): boolean {
  return Boolean(getServerK8sAuthorization());
}

function timeoutSignal(timeoutMs = config.requestTimeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

export async function requestK8sJson(path: string, options: { method?: string; body?: unknown } = {}) {
  if (!config.k8sApiServer) {
    throw new Error("K8S_API_SERVER is not configured");
  }

  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${config.k8sApiServer}${path}`, {
    method: options.method || "GET",
    signal: timeoutSignal(),
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Kubernetes request ${path} failed: ${response.status}${message ? ` ${message}` : ""}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function getK8sJson(path: string) {
  return requestK8sJson(path);
}

export async function getK8sText(path: string, timeoutMs = config.requestTimeoutMs) {
  if (!config.k8sApiServer) {
    throw new Error("K8S_API_SERVER is not configured");
  }

  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${config.k8sApiServer}${path}`, {
    signal: timeoutSignal(timeoutMs),
    headers: authorization ? { Authorization: authorization } : {},
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Kubernetes request ${path} failed: ${response.status}${text ? ` ${text}` : ""}`);
  }
  return text;
}
