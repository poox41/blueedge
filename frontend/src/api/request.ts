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

const BFF_BASE_URL = import.meta.env.VITE_BFF_BASE_URL || "/api";
const GATEWAY_BASE_URL = import.meta.env.VITE_GATEWAY_BASE_URL || "/product-api";

function getToken(): string | null {
  const raw = localStorage.getItem("token") || localStorage.getItem("blueedge.token");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : parsed?.token || raw;
  } catch {
    return raw;
  }
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
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "message" in data
        ? String((data as { message?: unknown }).message)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return {
    data: data as T,
    status: response.status,
    ok: response.ok,
  };
}

async function http<T, TBody = unknown>(baseUrl: string, path: string, options: RequestOptions<TBody> = {}) {
  const token = getToken();
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

  return parseResponse<T>(response);
}

export function bffRequest<T, TBody = unknown>(path: string, options?: RequestOptions<TBody>) {
  return http<T, TBody>(BFF_BASE_URL, path, options);
}

export function gatewayRequest<T, TBody = unknown>(path: string, options?: RequestOptions<TBody>) {
  return http<T, TBody>(GATEWAY_BASE_URL, path, options);
}
