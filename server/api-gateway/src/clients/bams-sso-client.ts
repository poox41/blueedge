import { config } from "../config.js";
import type { BamsExchangeErrorDto, BamsExchangePayload } from "../types/auth.js";

type BamsFetch = (input: URL, init: RequestInit) => Promise<Response>;

export class BamsSsoClientError extends Error {
  constructor(
    public readonly code: "BAMS_SSO_NOT_CONFIGURED" | "BAMS_SSO_UNAVAILABLE" | "BAMS_SSO_TIMEOUT" | "BAMS_SSO_REJECTED" | "BAMS_SSO_INVALID_RESPONSE",
    public readonly upstreamStatus?: number,
    public readonly upstreamErrorType?: string,
  ) {
    super(code);
    this.name = "BamsSsoClientError";
  }
}

function exchangeUrl(): URL {
  if (!config.bamsSsoBaseUrl || !config.bamsSsoClientId || !config.bamsSsoClientSecret) {
    throw new BamsSsoClientError("BAMS_SSO_NOT_CONFIGURED");
  }
  const target = new URL(config.bamsSsoExchangePath, `${config.bamsSsoBaseUrl}/`);
  if (target.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new BamsSsoClientError("BAMS_SSO_NOT_CONFIGURED");
  }
  return target;
}

function isBamsErrorDto(value: unknown): value is BamsExchangeErrorDto {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).error_info === "string" &&
    typeof (value as Record<string, unknown>).error_type === "string";
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new BamsSsoClientError("BAMS_SSO_INVALID_RESPONSE", response.status);
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new BamsSsoClientError("BAMS_SSO_INVALID_RESPONSE", response.status);
  }
}

/** Performs exactly one Exchange request. It never retries or follows redirects. */
export async function exchangeBamsAuthorizationCode(
  code: string,
  fetchImpl: BamsFetch = fetch,
): Promise<BamsExchangePayload> {
  const target = exchangeUrl();
  let response: Response;
  try {
    response = await fetchImpl(target, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(config.bamsSsoRequestTimeoutMs),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-BAMS-SSO-Client-Id": config.bamsSsoClientId,
        "X-BAMS-SSO-Client-Secret": config.bamsSsoClientSecret,
      },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new BamsSsoClientError("BAMS_SSO_TIMEOUT");
    }
    throw new BamsSsoClientError("BAMS_SSO_UNAVAILABLE");
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    if (!isBamsErrorDto(payload)) {
      throw new BamsSsoClientError("BAMS_SSO_INVALID_RESPONSE", response.status);
    }
    throw new BamsSsoClientError("BAMS_SSO_REJECTED", response.status, payload.error_type);
  }
  return payload;
}
