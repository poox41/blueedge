import fs from "node:fs";
import http from "node:http";
import https from "node:https";
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

interface K8sRequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

interface K8sRawResponse {
  status: number;
  body: Buffer;
}

function k8sTarget(path: string): URL {
  if (!config.k8sApiServer) {
    throw new Error("K8S_API_SERVER is not configured");
  }
  const base = `${config.k8sApiServer.replace(/\/+$/, "")}/`;
  const target = new URL(path.replace(/^\/+/, ""), base);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("K8S_API_SERVER must use http or https");
  }
  return target;
}

export function k8sTlsOptions(target: URL): https.RequestOptions {
  if (target.protocol !== "https:") return {};
  if (config.k8sSkipTlsVerify) return { rejectUnauthorized: false };
  return {
    rejectUnauthorized: true,
    ...(config.k8sCaFile ? { ca: fs.readFileSync(config.k8sCaFile) } : {}),
  };
}

async function requestK8sRaw(path: string, options: K8sRequestOptions = {}): Promise<K8sRawResponse> {
  const target = k8sTarget(path);
  const authorization = getServerK8sAuthorization();
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const client = target.protocol === "https:" ? https : http;

  return new Promise<K8sRawResponse>((resolve, reject) => {
    const request = client.request(target, {
      method: options.method || "GET",
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...k8sTlsOptions(target),
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks) });
      });
    });
    request.setTimeout(options.timeoutMs || config.requestTimeoutMs, () => {
      request.destroy(new Error("Kubernetes request timed out"));
    });
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

export async function requestK8sJson(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await requestK8sRaw(path, options);
  const text = response.body.toString("utf8");

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Kubernetes request ${path} failed: ${response.status}${text ? ` ${text}` : ""}`);
  }

  if (response.status === 204 || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Kubernetes request ${path} returned invalid JSON`);
  }
}

export async function getK8sJson(path: string) {
  return requestK8sJson(path);
}

export async function getK8sText(path: string, timeoutMs = config.requestTimeoutMs) {
  const response = await requestK8sRaw(path, { timeoutMs });
  const text = response.body.toString("utf8");
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Kubernetes request ${path} failed: ${response.status}${text ? ` ${text}` : ""}`);
  }
  return text;
}
