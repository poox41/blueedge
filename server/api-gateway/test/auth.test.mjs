import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createApp } from "../dist/app.js";
import { config } from "../dist/config.js";
import { createAuthToken, createLocalPrincipal, verifyAuthToken } from "../dist/middleware/auth.middleware.js";
import { authenticateLocalAdmin, authenticateServiceClient, bamsPublisherScopes, parseSsoAuthorizationCode } from "../dist/routes/auth.routes.js";
import { requireServiceScopes } from "../dist/middleware/auth.middleware.js";

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

test("BAMS publisher client uses an independent short-lived service identity", () => {
  const originalSecret = config.bamsPublisherClientSecret;
  config.bamsPublisherClientSecret = "test-client-secret";
  try {
    assert.equal(authenticateServiceClient(config.bamsPublisherClientId, "wrong-secret"), null);
    const principal = authenticateServiceClient(config.bamsPublisherClientId, "test-client-secret");
    assert.ok(principal);
    assert.equal(principal.authSource, "service");
    assert.deepEqual(principal.additionalClaims.scope, [...bamsPublisherScopes]);
    const payload = verifyAuthToken(createAuthToken(principal, 60));
    assert.equal(payload.auth_source, "service");
    assert.deepEqual(payload.scope, [...bamsPublisherScopes]);
  } finally {
    config.bamsPublisherClientSecret = originalSecret;
  }
});

test("client-token endpoint returns 401 for the wrong M2M secret", async () => {
  const originalSecret = config.bamsPublisherClientSecret;
  config.bamsPublisherClientSecret = "test-client-secret";
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/auth/client-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.bamsPublisherClientId,
        client_secret: "wrong-secret",
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { message: "invalid client credentials" });
  } finally {
    config.bamsPublisherClientSecret = originalSecret;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("service JWT is restricted to its allow-listed scoped APIs", async () => {
  const originalSecret = config.bamsPublisherClientSecret;
  config.bamsPublisherClientSecret = "test-client-secret";
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const tokenResponse = await fetch(`http://127.0.0.1:${address.port}/auth/client-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.bamsPublisherClientId,
        client_secret: "test-client-secret",
      }),
    });
    assert.equal(tokenResponse.status, 200);
    const { access_token: token } = await tokenResponse.json();

    const adminResponse = await fetch(`http://127.0.0.1:${address.port}/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(adminResponse.status, 403);
    assert.deepEqual(await adminResponse.json(), { message: "service identity is not allowed for this API" });

    const scopedResponse = await fetch(`http://127.0.0.1:${address.port}/blueedge/model-deployments/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(scopedResponse.status, 400);
    assert.deepEqual(await scopedResponse.json(), { message: "spaceId, modelRepoId, edgeUnit and image are required" });
  } finally {
    config.bamsPublisherClientSecret = originalSecret;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("service scope middleware rejects non-service and insufficient-scope principals", () => {
  const middleware = requireServiceScopes("model-deployments:publish");
  const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const nonServiceResponse = response();
  middleware({ auth: { principal: { authSource: "local", additionalClaims: {} } } }, nonServiceResponse, () => assert.fail("must not continue"));
  assert.equal(nonServiceResponse.statusCode, 403);

  const missingScopeResponse = response();
  middleware({ auth: { principal: { authSource: "service", additionalClaims: { scope: ["edge-units:read"] } } } }, missingScopeResponse, () => assert.fail("must not continue"));
  assert.equal(missingScopeResponse.statusCode, 403);
  assert.match(missingScopeResponse.body.message, /missing required scope/);
});
