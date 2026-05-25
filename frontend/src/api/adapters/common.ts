import type { KubeList, KubeResource } from "@/types/kubeedge";

export function asItems<T = KubeResource>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];

  const maybeData = payload as { data?: unknown; items?: unknown } | null;
  if (Array.isArray(maybeData?.items)) return maybeData.items as T[];
  if (Array.isArray((maybeData?.data as KubeList<T> | undefined)?.items)) {
    return ((maybeData?.data as KubeList<T>).items || []) as T[];
  }
  if (Array.isArray(maybeData?.data)) return maybeData.data as T[];

  return [];
}

export function getName(raw: KubeResource): string {
  return raw.metadata?.name || "-";
}

export function getNamespace(raw: KubeResource): string {
  return raw.metadata?.namespace || "default";
}

export function getCreatedAt(raw: KubeResource): string {
  return raw.metadata?.creationTimestamp || "-";
}

export function getNestedString(obj: unknown, path: string[], fallback = "-"): string {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return fallback;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : fallback;
}
