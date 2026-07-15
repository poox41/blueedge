import type express from "express";
import { config } from "../config.js";
import { getServerK8sAuthorization } from "./k8s-client.js";

function timeoutSignal() {
  return AbortSignal.timeout(config.requestTimeoutMs);
}

export async function getJson(path: string) {
  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${config.bffBaseUrl}${path}`, {
    signal: timeoutSignal(),
    headers: authorization ? { Authorization: authorization } : {},
  });

  if (!response.ok) {
    throw new Error(`BFF request ${path} failed: ${response.status}`);
  }

  return response.json();
}

export async function requestBffJson(path: string, options: { method?: string; body?: unknown } = {}) {
  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${config.bffBaseUrl}${path}`, {
    method: options.method || "GET",
    signal: timeoutSignal(),
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message = typeof data === "object" && data && "message" in data
      ? String((data as { message?: unknown }).message)
      : typeof data === "string" && data
        ? data
        : `BFF request ${path} failed: ${response.status}`;
    throw new Error(message);
  }

  return { data, status: response.status };
}

export async function proxyBffRequest(req: express.Request, res: express.Response) {
  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${config.bffBaseUrl}${req.url}`, {
    method: req.method,
    signal: timeoutSignal(),
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(req.body === undefined || req.method === "GET" || req.method === "HEAD"
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      req.body === undefined || req.method === "GET" || req.method === "HEAD"
        ? undefined
        : JSON.stringify(req.body),
  });

  const contentType = response.headers.get("content-type");
  if (contentType) res.type(contentType);
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status === 401) {
    res.status(502).json({ message: "上游 BFF 鉴权失败，请检查服务器访问凭证" });
    return;
  }
  res.status(response.status).send(body);
}
