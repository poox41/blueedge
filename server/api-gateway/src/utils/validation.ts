export const kubernetesNamePattern = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

export function readStringField(body: any, key: string): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body) || body[key] === undefined || body[key] === null) return undefined;
  return String(body[key]).trim();
}

export function readNumberField(body: any, key: string, fallback: number): number {
  const value = body?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readStringArrayField(body: any, key: string): string[] {
  const value = body?.[key];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

export function parseJsonField<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isValidKubernetesName(name: string): boolean {
  return kubernetesNamePattern.test(name);
}

export function isHostPort(value: string): boolean {
  return /^[a-zA-Z0-9.-]+:\d{1,5}$/.test(value) && Number(value.split(":").pop()) > 0 && Number(value.split(":").pop()) <= 65535;
}

