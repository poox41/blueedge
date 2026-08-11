import { exchangeBamsAuthorizationCode } from "../clients/bams-sso-client.js";
import { config } from "../config.js";
import type {
  BamsExchangeIdentityDto,
  BamsExchangePayload,
  BamsOrganizationDto,
  BamsPrincipalMapper,
  BamsSpaceDto,
  BamsSpaceRoleDto,
  BlueEdgePrincipal,
} from "../types/auth.js";

export class SsoServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SsoServiceError";
  }
}

interface BamsSsoServiceDependencies {
  mapper: BamsPrincipalMapper;
  exchangeCode?: typeof exchangeBamsAuthorizationCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRequiredString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOrganization(value: unknown): value is BamsOrganizationDto | null {
  return value === null || (
    isRecord(value) &&
    isRequiredString(value.id) &&
    isRequiredString(value.short_name) &&
    isRequiredString(value.name)
  );
}

function isSpace(value: unknown): value is BamsSpaceDto | null {
  return value === null || (
    isRecord(value) &&
    isRequiredString(value.id) &&
    isRequiredString(value.short_name) &&
    isRequiredString(value.name) &&
    isRequiredString(value.organization_id)
  );
}

function isSpaceRole(value: unknown): value is BamsSpaceRoleDto | null {
  return value === null || (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    isRequiredString(value.role_name) &&
    typeof value.role_code === "string"
  );
}

function parseIdentity(payload: BamsExchangePayload): BamsExchangeIdentityDto {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (
    !data ||
    !isRequiredString(data.sub) ||
    !isRequiredString(data.username)
  ) {
    throw new SsoServiceError(502, "SSO_UPSTREAM_ERROR", "BAMS SSO 服务返回了无效的身份数据");
  }
  if (!isRequiredString(data.platform_role)) {
    throw new SsoServiceError(403, "SSO_ACCESS_DENIED", "当前 BAMS 用户无权访问 BlueEdge");
  }
  if (
    !isOrganization(data.organization) ||
    !isNullableString(data.organization_role) ||
    !isSpace(data.space) ||
    !isNullableString(data.space_membership_role) ||
    !isSpaceRole(data.space_role)
  ) {
    throw new SsoServiceError(502, "SSO_UPSTREAM_ERROR", "BAMS SSO 服务返回了无效的身份数据");
  }
  return data as unknown as BamsExchangeIdentityDto;
}

export const mapBamsExchangePayload: BamsPrincipalMapper = (payload) => {
  const identity = parseIdentity(payload);
  if (identity.platform_role !== "platform_admin") {
    throw new SsoServiceError(403, "SSO_ACCESS_DENIED", "当前 BAMS 用户无权访问 BlueEdge");
  }
  return {
    subject: identity.sub,
    username: identity.username,
    authSource: "bams",
    additionalClaims: {
      platform_role: identity.platform_role,
      organization_id: identity.organization?.id ?? null,
      space_id: identity.space?.id ?? null,
      space_role_id: identity.space_role?.id ?? null,
    },
  };
};

export function createBamsSsoService(dependencies: BamsSsoServiceDependencies) {
  return {
    async exchangeCodeForPrincipal(code: string): Promise<BlueEdgePrincipal> {
      if (!config.bamsSsoEnabled) {
        throw new SsoServiceError(503, "SSO_NOT_ENABLED", "BAMS SSO 尚未启用");
      }
      const payload = await (dependencies.exchangeCode || exchangeBamsAuthorizationCode)(code);
      return dependencies.mapper(payload);
    },
  };
}

export const bamsSsoService = createBamsSsoService({ mapper: mapBamsExchangePayload });
