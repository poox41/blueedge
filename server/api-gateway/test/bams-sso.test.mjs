import assert from "node:assert/strict";
import test from "node:test";
import {
  BamsSsoClientError,
  exchangeBamsAuthorizationCode,
} from "../dist/clients/bams-sso-client.js";
import { config, isAllowedSsoBaseUrl } from "../dist/config.js";
import { createAuthToken, verifyAuthToken } from "../dist/middleware/auth.middleware.js";
import { mapBamsSsoClientError } from "../dist/routes/auth.routes.js";
import {
  createBamsSsoService,
  mapBamsExchangePayload,
  SsoServiceError,
} from "../dist/services/bams-sso.service.js";

const platformAdminWithoutSpace = {
  data: {
    sub: "bams-user-id",
    username: "admin",
    platform_role: "platform_admin",
    organization: null,
    organization_role: null,
    space: null,
    space_membership_role: null,
    space_role: null,
  },
};

const platformAdminWithSpace = {
  data: {
    sub: "bams-member-id",
    username: "member",
    platform_role: "platform_admin",
    organization: {
      id: "organization-id",
      short_name: "edge-org",
      name: "Edge Organization",
    },
    organization_role: "organization_member",
    space: {
      id: "space-id",
      short_name: "edge-space",
      name: "Edge Space",
      organization_id: "organization-id",
    },
    space_membership_role: "space_member",
    space_role: {
      id: 12,
      role_name: "BlueEdge User",
      role_code: "",
    },
  },
};

test("HTTP SSO is allowed only for the fixed TEST BAMS endpoint", () => {
  assert.equal(isAllowedSsoBaseUrl("https://bams.example.test"), true);
  assert.equal(isAllowedSsoBaseUrl("http://14.103.139.131:40002", false), false);
  assert.equal(isAllowedSsoBaseUrl("http://14.103.139.131:40002", true), true);
  assert.equal(isAllowedSsoBaseUrl("http://bams.example.test", true), false);
});

test("BAMS client exchanges through the explicitly enabled fixed TEST HTTP endpoint", async () => {
  const previous = {
    baseUrl: config.bamsSsoBaseUrl,
    allowInsecureTestHttp: config.allowInsecureTestHttp,
    clientId: config.bamsSsoClientId,
    clientSecret: config.bamsSsoClientSecret,
  };
  config.bamsSsoBaseUrl = "http://14.103.139.131:40002";
  config.allowInsecureTestHttp = true;
  config.bamsSsoClientId = "blueedge";
  config.bamsSsoClientSecret = "test-client-secret";
  try {
    let capturedUrl;
    const payload = await exchangeBamsAuthorizationCode("A".repeat(43), async (url) => {
      capturedUrl = url;
      return Response.json(platformAdminWithoutSpace);
    });
    assert.deepEqual(payload, platformAdminWithoutSpace);
    assert.equal(capturedUrl.toString(), "http://14.103.139.131:40002/v1/sso/blueedge/exchange");
  } finally {
    config.bamsSsoBaseUrl = previous.baseUrl;
    config.allowInsecureTestHttp = previous.allowInsecureTestHttp;
    config.bamsSsoClientId = previous.clientId;
    config.bamsSsoClientSecret = previous.clientSecret;
  }
});

async function withBamsClientConfig(callback) {
  const previous = {
    baseUrl: config.bamsSsoBaseUrl,
    clientId: config.bamsSsoClientId,
    clientSecret: config.bamsSsoClientSecret,
  };
  config.bamsSsoBaseUrl = "https://bams.example.test";
  config.bamsSsoClientId = "blueedge";
  config.bamsSsoClientSecret = "test-client-secret";
  try {
    await callback();
  } finally {
    config.bamsSsoBaseUrl = previous.baseUrl;
    config.bamsSsoClientId = previous.clientId;
    config.bamsSsoClientSecret = previous.clientSecret;
  }
}

test("platform_admin without Space maps to a BlueEdge Principal", () => {
  const principal = mapBamsExchangePayload(platformAdminWithoutSpace);
  assert.deepEqual(principal, {
    subject: "bams-user-id",
    username: "admin",
    authSource: "bams",
    additionalClaims: {
      platform_role: "platform_admin",
      organization_id: null,
      space_id: null,
      space_role_id: null,
    },
  });
});

test("platform_admin with Space records context without using it for authorization", () => {
  const principal = mapBamsExchangePayload(platformAdminWithSpace);
  assert.equal(principal.authSource, "bams");
  assert.equal(principal.additionalClaims.organization_id, "organization-id");
  assert.equal(principal.additionalClaims.space_id, "space-id");
  assert.equal(principal.additionalClaims.space_role_id, 12);
});

test("platform_member is denied before BlueEdge JWT issuance", () => {
  assert.throws(
    () => mapBamsExchangePayload({
      ...platformAdminWithoutSpace,
      data: { ...platformAdminWithoutSpace.data, platform_role: "platform_member" },
    }),
    (error) => error instanceof SsoServiceError && error.status === 403 && error.code === "SSO_ACCESS_DENIED",
  );
});

test("unknown or missing platform role is denied", () => {
  for (const platformRole of ["unknown_role", undefined]) {
    const identity = { ...platformAdminWithoutSpace.data };
    if (platformRole === undefined) delete identity.platform_role;
    else identity.platform_role = platformRole;
    assert.throws(
      () => mapBamsExchangePayload({ data: identity }),
      (error) => error instanceof SsoServiceError && error.status === 403 && error.code === "SSO_ACCESS_DENIED",
    );
  }
});

test("missing sub is rejected as an invalid BAMS response", () => {
  const { sub: _sub, ...identity } = platformAdminWithoutSpace.data;
  assert.throws(
    () => mapBamsExchangePayload({ data: identity }),
    (error) => error instanceof SsoServiceError && error.status === 502 && error.code === "SSO_UPSTREAM_ERROR",
  );
});

test("missing username is rejected as an invalid BAMS response", () => {
  const { username: _username, ...identity } = platformAdminWithoutSpace.data;
  assert.throws(
    () => mapBamsExchangePayload({ data: identity }),
    (error) => error instanceof SsoServiceError && error.status === 502 && error.code === "SSO_UPSTREAM_ERROR",
  );
});

test("BAMS invalid_grant maps to the frozen BlueEdge error", () => {
  const mapped = mapBamsSsoClientError(
    new BamsSsoClientError("BAMS_SSO_REJECTED", 400, "blueedge_sso_invalid_grant"),
  );
  assert.deepEqual(mapped, {
    status: 400,
    code: "SSO_CODE_INVALID_OR_EXPIRED",
    message: "SSO 登录凭证无效或已过期，请返回 BAMS 重新进入",
  });
});

test("BAMS invalid_client maps to an upstream authentication failure", () => {
  const mapped = mapBamsSsoClientError(
    new BamsSsoClientError("BAMS_SSO_REJECTED", 401, "blueedge_sso_invalid_client"),
  );
  assert.equal(mapped.status, 502);
  assert.equal(mapped.code, "SSO_UPSTREAM_AUTH_FAILED");
});

test("BAMS 503 error DTO maps to service unavailable", async () => {
  await withBamsClientConfig(async () => {
    let rejected;
    try {
      await exchangeBamsAuthorizationCode(
        "A".repeat(43),
        async () => Response.json(
          { error_info: "temporarily unavailable", error_type: "blueedge_sso_unavailable" },
          { status: 503 },
        ),
      );
    } catch (error) {
      rejected = error;
    }
    assert.ok(rejected instanceof BamsSsoClientError);
    const mapped = mapBamsSsoClientError(rejected);
    assert.equal(mapped.status, 503);
    assert.equal(mapped.code, "SSO_SERVICE_UNAVAILABLE");
  });
});

test("BAMS client rejects invalid JSON as an upstream response error", async () => {
  await withBamsClientConfig(async () => {
    await assert.rejects(
      exchangeBamsAuthorizationCode(
        "A".repeat(43),
        async () => new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
      (error) => error instanceof BamsSsoClientError && error.code === "BAMS_SSO_INVALID_RESPONSE",
    );
  });
});

test("BAMS client sends the frozen contract exactly once without Authorization", async () => {
  await withBamsClientConfig(async () => {
    let calls = 0;
    let capturedUrl;
    let capturedInit;
    const payload = await exchangeBamsAuthorizationCode("A".repeat(43), async (url, init) => {
      calls += 1;
      capturedUrl = url;
      capturedInit = init;
      return Response.json(platformAdminWithoutSpace);
    });

    assert.deepEqual(payload, platformAdminWithoutSpace);
    assert.equal(calls, 1);
    assert.equal(capturedUrl.toString(), "https://bams.example.test/v1/sso/blueedge/exchange");
    assert.equal(capturedInit.method, "POST");
    assert.equal(capturedInit.redirect, "error");
    assert.equal(capturedInit.headers.Authorization, undefined);
    assert.equal(capturedInit.headers["X-BAMS-SSO-Client-Id"], "blueedge");
    assert.equal(capturedInit.headers["X-BAMS-SSO-Client-Secret"], "test-client-secret");
    assert.deepEqual(JSON.parse(capturedInit.body), {
      grant_type: "authorization_code",
      code: "A".repeat(43),
    });
  });
});

test("BAMS client never retries a failed one-time Code", async () => {
  await withBamsClientConfig(async () => {
    let calls = 0;
    await assert.rejects(
      exchangeBamsAuthorizationCode("A".repeat(43), async () => {
        calls += 1;
        throw new Error("network unavailable");
      }),
      (error) => error instanceof BamsSsoClientError && error.code === "BAMS_SSO_UNAVAILABLE",
    );
    assert.equal(calls, 1);
  });
});

test("real SSO service maps an exchanged admin and issues an eight-hour JWT", async () => {
  const previousEnabled = config.bamsSsoEnabled;
  config.bamsSsoEnabled = true;
  try {
    const service = createBamsSsoService({
      mapper: mapBamsExchangePayload,
      exchangeCode: async () => platformAdminWithoutSpace,
    });
    const principal = await service.exchangeCodeForPrincipal("A".repeat(43));
    const payload = verifyAuthToken(createAuthToken(principal, config.bamsSsoJwtExpiresInSeconds));
    assert.ok(payload);
    assert.equal(payload.auth_source, "bams");
    assert.equal(payload.platform_role, "platform_admin");
    assert.equal(payload.organization_id, null);
    assert.equal(payload.space_id, null);
    assert.equal(payload.space_role_id, null);
    assert.equal(payload.exp - payload.iat, 8 * 60 * 60);
  } finally {
    config.bamsSsoEnabled = previousEnabled;
  }
});
