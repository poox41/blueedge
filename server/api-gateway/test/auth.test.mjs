import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { config } from "../dist/config.js";
import { createAuthToken, createLocalPrincipal, verifyAuthToken } from "../dist/middleware/auth.middleware.js";
import { authenticateLocalAdmin, parseSsoAuthorizationCode } from "../dist/routes/auth.routes.js";

test("local authentication issues the unified BlueEdge JWT", () => {
  const token = createAuthToken(createLocalPrincipal("admin"));
  const payload = verifyAuthToken(token);
  assert.ok(payload);
  assert.equal(payload.sub, "admin");
  assert.equal(payload.username, "admin");
  assert.equal(payload.auth_source, "local");
  assert.equal(payload.iss, config.jwtIssuer);
  assert.equal(payload.aud, config.jwtAudience);
});

test("reserved JWT claims cannot be overridden by a Principal", () => {
  const token = createAuthToken({
    subject: "42",
    username: "bams-admin",
    authSource: "bams",
    additionalClaims: {
      platform_role: "platform_admin",
      organization_id: null,
      iss: "untrusted-issuer",
    },
  });
  const payload = verifyAuthToken(token);
  assert.ok(payload);
  assert.equal(payload.iss, config.jwtIssuer);
  assert.equal(payload.platform_role, "platform_admin");
  assert.equal(payload.organization_id, null);
});

test("existing ADMIN_USERNAME and ADMIN_PASSWORD login remains available", () => {
  const principal = authenticateLocalAdmin(config.adminUsername, config.adminPassword);
  assert.ok(principal);
  assert.equal(principal.authSource, "local");
  assert.equal(authenticateLocalAdmin(config.adminUsername, "wrong-password"), null);
});

test("pre-Principal local JWTs remain valid until their original expiry", () => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: "admin", username: "admin", iat: now, exp: now + 60 })).toString("base64url");
  const signature = crypto.createHmac("sha256", config.jwtSecret).update(`${header}.${body}`).digest("base64url");
  const payload = verifyAuthToken(`${header}.${body}.${signature}`);
  assert.ok(payload);
  assert.equal(payload.auth_source, "local");
  assert.equal(payload.iss, config.jwtIssuer);
  assert.equal(payload.aud, config.jwtAudience);
});

test("SSO skeleton validates the opaque authorization code shape", () => {
  const opaqueCode = "A".repeat(43);
  assert.equal(parseSsoAuthorizationCode({ grant_type: "authorization_code", code: opaqueCode }), opaqueCode);
  assert.equal(parseSsoAuthorizationCode({ grant_type: "authorization_code", code: "too-short" }), null);
  assert.equal(parseSsoAuthorizationCode({ grant_type: "other", code: opaqueCode }), null);
});
