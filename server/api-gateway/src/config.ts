import fs from "node:fs";

function parseDurationSeconds(value: string, fallback: number): number {
  const match = value.match(/^(\d+)([smhd])?$/);
  if (!match) return fallback;

  const amount = Number(match[1]);
  if (amount <= 0) return fallback;
  const unit = match[2] || "s";
  const factors: Record<string, number> = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
  return amount * factors[unit];
}

function readSecretFile(path: string): string {
  if (!path) return "";
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const defaultServiceAccountCaFile = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

export const config = {
  port: Number(process.env.PORT || 7001),
  bffBaseUrl: process.env.BFF_BASE_URL || "http://127.0.0.1:8080/api/v1",
  k8sApiServer: process.env.K8S_API_SERVER || "",
  k8sSkipTlsVerify: process.env.K8S_SKIP_TLS_VERIFY === "true",
  k8sAuthHeader: process.env.K8S_AUTH_HEADER || "",
  k8sToken: process.env.K8S_TOKEN || "",
  k8sTokenFile: process.env.K8S_TOKEN_FILE || "",
  k8sCaFile: process.env.K8S_CA_FILE || (fs.existsSync(defaultServiceAccountCaFile) ? defaultServiceAccountCaFile : ""),
  blueedgeSystemNamespace: process.env.BLUEEDGE_SYSTEM_NAMESPACE || "blueedge-system",
  kubeEdgeTokenSecretNamespace: process.env.KUBEEDGE_TOKEN_SECRET_NAMESPACE || "kubeedge",
  kubeEdgeTokenSecretName: process.env.KUBEEDGE_TOKEN_SECRET_NAME || "tokensecret",
  kubeEdgeTokenSecretKey: process.env.KUBEEDGE_TOKEN_SECRET_KEY || "tokendata",
  kubeEdgeTokenMinValiditySeconds: Number(process.env.KUBEEDGE_TOKEN_MIN_VALIDITY_SECONDS || 300),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "2026@bluedot",
  jwtSecret: process.env.JWT_SECRET || "blueedge-dev-secret",
  jwtExpiresInSeconds: parseDurationSeconds(process.env.JWT_EXPIRES_IN || "24h", 24 * 60 * 60),
  jwtIssuer: process.env.JWT_ISSUER || "blueedge",
  jwtAudience: process.env.JWT_AUDIENCE || "blueedge-api",
  bamsSsoEnabled: process.env.BAMS_SSO_ENABLED === "true",
  bamsSsoBaseUrl: (process.env.BAMS_SSO_BASE_URL || "").replace(/\/+$/, ""),
  bamsSsoExchangePath: process.env.BAMS_SSO_EXCHANGE_PATH || "/v1/sso/blueedge/exchange",
  bamsSsoClientId: process.env.BAMS_SSO_CLIENT_ID || "blueedge",
  bamsSsoClientSecret:
    process.env.BAMS_SSO_CLIENT_SECRET || readSecretFile(process.env.BAMS_SSO_CLIENT_SECRET_FILE || ""),
  bamsSsoRequestTimeoutMs: parsePositiveInteger(process.env.BAMS_SSO_REQUEST_TIMEOUT_MS, 5_000),
  bamsSsoJwtExpiresInSeconds: parseDurationSeconds(
    process.env.BAMS_SSO_JWT_EXPIRES_IN || "8h",
    8 * 60 * 60,
  ),
  corsAllowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS),
  trustProxyHops: Math.max(0, Number(process.env.TRUST_PROXY_HOPS || 0) || 0),
  authRateLimitWindowMs: parsePositiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000),
  loginRateLimitMax: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_MAX, 20),
  ssoRateLimitMax: parsePositiveInteger(process.env.SSO_RATE_LIMIT_MAX, 20),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30_000),
  modelRegistryUrl: (process.env.MODEL_REGISTRY_URL || "").replace(/\/+$/, ""),
  modelRegistryUsername: process.env.MODEL_REGISTRY_USERNAME || "",
  modelRegistryPassword: process.env.MODEL_REGISTRY_PASSWORD || readSecretFile(process.env.MODEL_REGISTRY_PASSWORD_FILE || ""),
  modelRegistryPrefix: (process.env.MODEL_REGISTRY_PREFIX || "app").replace(/^\/+|\/+$/g, ""),
  modelRegistrySkipTlsVerify: process.env.MODEL_REGISTRY_SKIP_TLS_VERIFY === "true",
};

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  throw new Error(
    "NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed; use K8S_SKIP_TLS_VERIFY or MODEL_REGISTRY_SKIP_TLS_VERIFY for a scoped client",
  );
}

if (process.env.NODE_ENV === "production") {
  if (!process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD is required in production");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required in production");
  }
  if (config.bamsSsoEnabled) {
    if (!config.bamsSsoBaseUrl || !config.bamsSsoClientId || !config.bamsSsoClientSecret) {
      throw new Error("BAMS SSO base URL, client id, and client secret are required when BAMS_SSO_ENABLED=true");
    }
    if (new URL(config.bamsSsoBaseUrl).protocol !== "https:") {
      throw new Error("BAMS_SSO_BASE_URL must use https in production");
    }
  }
}
