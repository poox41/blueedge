export type AuthSource = "local" | "bams" | "service";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface BlueEdgePrincipal {
  subject: string;
  username: string;
  authSource: AuthSource;
  additionalClaims?: Record<string, JsonValue>;
}

export interface BlueEdgeJwtPayload extends Record<string, JsonValue> {
  sub: string;
  username: string;
  auth_source: AuthSource;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface BlueEdgeAuthContext {
  principal: BlueEdgePrincipal;
  token: BlueEdgeJwtPayload;
}

export interface BamsOrganizationDto {
  id: string;
  short_name: string;
  name: string;
}

export interface BamsSpaceDto {
  id: string;
  short_name: string;
  name: string;
  organization_id: string;
}

export interface BamsSpaceRoleDto {
  id: number;
  role_name: string;
  role_code: string;
}

export interface BamsExchangeIdentityDto {
  sub: string;
  username: string;
  platform_role: string;
  organization: BamsOrganizationDto | null;
  organization_role: string | null;
  space: BamsSpaceDto | null;
  space_membership_role: string | null;
  space_role: BamsSpaceRoleDto | null;
}

export interface BamsExchangeSuccessDto {
  data: BamsExchangeIdentityDto;
}

export type BamsExchangeErrorType =
  | "blueedge_sso_invalid_request"
  | "blueedge_sso_invalid_grant"
  | "blueedge_sso_space_required"
  | "blueedge_sso_invalid_client"
  | "blueedge_sso_access_denied"
  | "blueedge_sso_unavailable";

export interface BamsExchangeErrorDto {
  error_info: string;
  error_type: BamsExchangeErrorType;
}

// Network payloads stay untrusted until runtime DTO validation succeeds.
export type BamsExchangePayload = unknown;

export type BamsPrincipalMapper = (payload: BamsExchangePayload) => BlueEdgePrincipal;
