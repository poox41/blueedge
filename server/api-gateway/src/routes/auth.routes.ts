import type { Express, Response } from "express";
import { BamsSsoClientError } from "../clients/bams-sso-client.js";
import { config } from "../config.js";
import { createAuthToken, createLocalPrincipal } from "../middleware/auth.middleware.js";
import { createRateLimitMiddleware } from "../middleware/rate-limit.middleware.js";
import { bamsSsoService, SsoServiceError } from "../services/bams-sso.service.js";

const authorizationCodePattern = /^[A-Za-z0-9_-]{32,128}$/;

export function authenticateLocalAdmin(username: string, password: string) {
  if (username !== config.adminUsername || password !== config.adminPassword) return null;
  return createLocalPrincipal(username);
}

export function parseSsoAuthorizationCode(body: unknown): string | null {
  const requestBody = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const grantType = typeof requestBody.grant_type === "string" ? requestBody.grant_type : "";
  const code = typeof requestBody.code === "string" ? requestBody.code.trim() : "";
  return grantType === "authorization_code" && authorizationCodePattern.test(code) ? code : null;
}

const loginRateLimit = createRateLimitMiddleware({
  windowMs: config.authRateLimitWindowMs,
  max: config.loginRateLimitMax,
  code: "LOGIN_RATE_LIMITED",
  message: "登录请求过于频繁，请稍后重试",
});

const ssoRateLimit = createRateLimitMiddleware({
  windowMs: config.authRateLimitWindowMs,
  max: config.ssoRateLimitMax,
  code: "SSO_RATE_LIMITED",
  message: "SSO 请求过于频繁，请返回 BAMS 后稍后重试",
});

function sendSsoError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ code, message });
}

interface SsoErrorResponse {
  status: number;
  code: string;
  message: string;
}

export function mapBamsSsoClientError(error: BamsSsoClientError): SsoErrorResponse {
  if (error.code === "BAMS_SSO_TIMEOUT") {
    return { status: 504, code: "SSO_UPSTREAM_TIMEOUT", message: "BAMS SSO 服务响应超时，请返回 BAMS 重新进入" };
  }
  if (error.code === "BAMS_SSO_UNAVAILABLE" || error.code === "BAMS_SSO_NOT_CONFIGURED") {
    return { status: 503, code: "SSO_SERVICE_UNAVAILABLE", message: "BAMS SSO 服务暂时不可用，请返回 BAMS 后重试" };
  }
  if (error.code === "BAMS_SSO_REJECTED") {
    const upstreamErrors: Record<string, SsoErrorResponse> = {
      blueedge_sso_invalid_request: {
        status: 400,
        code: "SSO_INVALID_REQUEST",
        message: "SSO 登录请求无效，请返回 BAMS 重新进入",
      },
      blueedge_sso_invalid_grant: {
        status: 400,
        code: "SSO_CODE_INVALID_OR_EXPIRED",
        message: "SSO 登录凭证无效或已过期，请返回 BAMS 重新进入",
      },
      blueedge_sso_space_required: {
        status: 403,
        code: "SSO_SPACE_REQUIRED",
        message: "当前 BAMS 用户需要选择 Space 后才能继续",
      },
      blueedge_sso_invalid_client: {
        status: 502,
        code: "SSO_UPSTREAM_AUTH_FAILED",
        message: "BlueEdge 与 BAMS 的服务认证失败，请联系系统管理员",
      },
      blueedge_sso_access_denied: {
        status: 403,
        code: "SSO_ACCESS_DENIED",
        message: "当前 BAMS 用户无权访问 BlueEdge",
      },
      blueedge_sso_unavailable: {
        status: 503,
        code: "SSO_SERVICE_UNAVAILABLE",
        message: "BAMS SSO 服务暂时不可用，请返回 BAMS 后重试",
      },
    };
    const mapped = error.upstreamErrorType ? upstreamErrors[error.upstreamErrorType] : undefined;
    if (mapped) return mapped;
  }
  return { status: 502, code: "SSO_UPSTREAM_ERROR", message: "BAMS SSO 服务返回异常，请联系系统管理员" };
}

export function registerPublicAuthRoutes(app: Express) {
  app.post("/auth/login", loginRateLimit, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const principal = authenticateLocalAdmin(username, password);
    if (!principal) {
      res.status(401).json({ message: "账号或密码错误" });
      return;
    }
    res.json({ token: createAuthToken(principal) });
  });

  app.post("/auth/sso/exchange", ssoRateLimit, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const code = parseSsoAuthorizationCode(req.body);
    if (!code) {
      sendSsoError(res, 400, "SSO_INVALID_REQUEST", "SSO 登录参数无效，请返回 BAMS 重新进入");
      return;
    }

    try {
      const principal = await bamsSsoService.exchangeCodeForPrincipal(code);
      res.json({ token: createAuthToken(principal, config.bamsSsoJwtExpiresInSeconds) });
    } catch (error) {
      if (error instanceof SsoServiceError) {
        sendSsoError(res, error.status, error.code, error.message);
        return;
      }
      if (error instanceof BamsSsoClientError) {
        const mapped = mapBamsSsoClientError(error);
        sendSsoError(res, mapped.status, mapped.code, mapped.message);
        return;
      }
      sendSsoError(res, 500, "SSO_LOGIN_FAILED", "SSO 登录未完成，请返回 BAMS 重新进入");
    }
  });
}
