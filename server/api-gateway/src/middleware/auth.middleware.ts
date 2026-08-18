import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import type { AuthSource, BlueEdgeJwtPayload, BlueEdgePrincipal, JsonValue } from "../types/auth.js";

const jwtHeader = { alg: "HS256", typ: "JWT" } as const;
const reservedClaims = new Set(["sub", "username", "auth_source", "iss", "aud", "iat", "exp"]);

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: BlueEdgeJwtPayload): string {
  const encodedHeader = base64Url(JSON.stringify(jwtHeader));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function isAuthSource(value: unknown): value is AuthSource {
  return value === "local" || value === "bams" || value === "service";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function verifyAuthToken(token: string): BlueEdgeJwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as unknown;
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
    if (!isRecord(header) || header.alg !== jwtHeader.alg || header.typ !== jwtHeader.typ) return null;
    if (!isRecord(payload)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.sub !== "string" || !payload.sub ||
      typeof payload.username !== "string" || !payload.username ||
      typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || payload.iat > now + 60 ||
      typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= now
    ) {
      return null;
    }

    const legacyLocalToken = payload.auth_source === undefined && payload.iss === undefined && payload.aud === undefined;
    if (legacyLocalToken) {
      // Tokens issued before the unified Principal rollout remain valid until
      // their original expiry. All newly issued tokens use the strict format.
      return {
        ...payload,
        auth_source: "local",
        iss: config.jwtIssuer,
        aud: config.jwtAudience,
      } as BlueEdgeJwtPayload;
    }
    if (
      !isAuthSource(payload.auth_source) ||
      payload.iss !== config.jwtIssuer ||
      payload.aud !== config.jwtAudience
    ) {
      return null;
    }
    return payload as BlueEdgeJwtPayload;
  } catch {
    return null;
  }
}

function extractBearerToken(authorization?: string): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function safeAdditionalClaims(claims: Record<string, JsonValue> | undefined): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(claims || {}).filter(([key]) => !reservedClaims.has(key)),
  );
}

export function createLocalPrincipal(username: string): BlueEdgePrincipal {
  return {
    subject: username,
    username,
    authSource: "local",
  };
}

export function createAuthToken(principal: BlueEdgePrincipal, expiresInSeconds = config.jwtExpiresInSeconds): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    ...safeAdditionalClaims(principal.additionalClaims),
    sub: principal.subject,
    username: principal.username,
    auth_source: principal.authSource,
    iss: config.jwtIssuer,
    aud: config.jwtAudience,
    iat: now,
    exp: now + expiresInSeconds,
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  const payload = token ? verifyAuthToken(token) : null;
  if (!payload) {
    res.status(401).json({ message: "unauthorized" });
    return;
  }
  req.auth = {
    principal: {
      subject: payload.sub,
      username: payload.username,
      authSource: payload.auth_source,
      additionalClaims: Object.fromEntries(
        Object.entries(payload).filter(([key]) => !reservedClaims.has(key)),
      ) as Record<string, JsonValue>,
    },
    token: payload,
  };
  next();
}

export function requireServiceScopes(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.auth?.principal.authSource !== "service") {
      res.status(403).json({ message: "service identity required" });
      return;
    }
    const rawScopes = req.auth.principal.additionalClaims?.scope;
    const scopes = new Set(
      Array.isArray(rawScopes)
        ? rawScopes.filter((item): item is string => typeof item === "string")
        : typeof rawScopes === "string"
          ? rawScopes.split(/\s+/).filter(Boolean)
          : [],
    );
    const missing = requiredScopes.filter((scope) => !scopes.has(scope));
    if (missing.length > 0) {
      res.status(403).json({ message: `missing required scope: ${missing.join(", ")}` });
      return;
    }
    next();
  };
}

export function rejectServiceIdentity(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.principal.authSource === "service") {
    res.status(403).json({ message: "service identity is not allowed for this API" });
    return;
  }
  next();
}
