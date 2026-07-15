function parseDurationSeconds(value: string): number {
  const match = value.match(/^(\d+)([smhd])?$/);
  if (!match) return 24 * 60 * 60;

  const amount = Number(match[1]);
  const unit = match[2] || "s";
  const factors: Record<string, number> = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
  return amount * factors[unit];
}

export const config = {
  port: Number(process.env.PORT || 7001),
  bffBaseUrl: process.env.BFF_BASE_URL || "http://127.0.0.1:8080/api/v1",
  k8sApiServer: process.env.K8S_API_SERVER || "",
  k8sSkipTlsVerify: process.env.K8S_SKIP_TLS_VERIFY === "true",
  k8sAuthHeader: process.env.K8S_AUTH_HEADER || "",
  k8sToken: process.env.K8S_TOKEN || "",
  k8sTokenFile: process.env.K8S_TOKEN_FILE || "",
  blueedgeSystemNamespace: process.env.BLUEEDGE_SYSTEM_NAMESPACE || "blueedge-system",
  kubeEdgeTokenSecretNamespace: process.env.KUBEEDGE_TOKEN_SECRET_NAMESPACE || "kubeedge",
  kubeEdgeTokenSecretName: process.env.KUBEEDGE_TOKEN_SECRET_NAME || "tokensecret",
  kubeEdgeTokenSecretKey: process.env.KUBEEDGE_TOKEN_SECRET_KEY || "tokendata",
  kubeEdgeTokenMinValiditySeconds: Number(process.env.KUBEEDGE_TOKEN_MIN_VALIDITY_SECONDS || 300),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "2026@bluedot",
  jwtSecret: process.env.JWT_SECRET || "blueedge-dev-secret",
  jwtExpiresInSeconds: parseDurationSeconds(process.env.JWT_EXPIRES_IN || "24h"),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30_000),
};

if (process.env.NODE_ENV === "production") {
  if (!process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_PASSWORD is required in production");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required in production");
  }
}

if (config.k8sSkipTlsVerify) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}
