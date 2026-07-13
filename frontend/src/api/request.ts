export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions<TBody = unknown> {
  method?: HttpMethod;
  body?: TBody;
  params?: Record<string, string | number | boolean | undefined | null>;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export interface ApiEnvelope<T = unknown> {
  data: T;
  status: number;
  ok: boolean;
}

const TOKEN_KEY = "blueedge_token";
const BFF_BASE_URL = import.meta.env.VITE_BFF_BASE_URL || "/product-api/bff";
const GATEWAY_BASE_URL = import.meta.env.VITE_GATEWAY_BASE_URL || "/product-api";

export function getBlueEdgeToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setBlueEdgeToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearBlueEdgeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function buildUrl(baseUrl: string, path: string, params?: RequestOptions["params"]): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`, window.location.origin);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return `${url.pathname}${url.search}${url.hash}`;
}

async function parseResponse<T>(response: Response): Promise<ApiEnvelope<T>> {
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    if (!isJson && import.meta.env.DEV && typeof data === "string" && data.trim()) {
      console.error("Non-JSON API error response", {
        status: response.status,
        contentType,
        text: data,
      });
    }

    const jsonMessage = typeof data === "object" && data
      ? ["message", "error", "code"]
          .map((key) => (data as Record<string, unknown>)[key])
          .find((value) => typeof value === "string" && value.trim())
      : undefined;
    const statusMessage: Record<number, string> = {
      401: "登录状态已失效",
      403: "没有操作权限",
      404: "请求的接口不存在，请确认服务版本是否已更新",
      502: "上游服务暂时不可用",
      503: "集群服务暂时不可用",
    };
    const message = typeof jsonMessage === "string"
      ? jsonMessage
      : statusMessage[response.status] || "请求失败，请稍后重试";
    throw new Error(message);
  }

  return {
    data: data as T,
    status: response.status,
    ok: response.ok,
  };
}

async function http<T, TBody = unknown>(baseUrl: string, path: string, options: RequestOptions<TBody> = {}) {
  const token = getBlueEdgeToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(buildUrl(baseUrl, path, options.params), {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 401 && baseUrl === GATEWAY_BASE_URL && window.location.hash !== "#/login") {
    clearBlueEdgeToken();
    window.location.hash = "/login";
  }

  return parseResponse<T>(response);
}

export function bffRequest<T, TBody = unknown>(path: string, options?: RequestOptions<TBody>) {
  return http<T, TBody>(BFF_BASE_URL, path, options);
}

export function gatewayRequest<T, TBody = unknown>(path: string, options?: RequestOptions<TBody>) {
  return http<T, TBody>(GATEWAY_BASE_URL, path, options);
}

export async function loginRequest(username: string, password: string): Promise<string> {
  const res = await http<{ token: string }, { username: string; password: string }>(GATEWAY_BASE_URL, "/auth/login", {
    method: "POST",
    body: { username, password },
  });
  return res.data.token;
}
