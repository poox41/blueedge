import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: JwtPayload): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token: string): JwtPayload | null {
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
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as JwtPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractBearerToken(authorization?: string): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export function createAuthToken(username: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: username,
    username,
    iat: now,
    exp: now + config.jwtExpiresInSeconds,
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token || !verifyJwt(token)) {
    res.status(401).json({ message: "unauthorized" });
    return;
  }
  next();
}
