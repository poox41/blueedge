import type { KubeResource } from "@/types/kubeedge";

export function formatLabels(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return "-";
  return Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function mapSubjects(subjects: unknown): Array<{ kind: string; name: string; namespace: string }> {
  if (!Array.isArray(subjects)) return [];
  return subjects.map((subject: any) => ({
    kind: subject?.kind || "-",
    name: subject?.name || "-",
    namespace: subject?.namespace || "-",
  }));
}

export function getResourceName(item: KubeResource): string {
  return item.metadata?.name || "-";
}

export function getResourceNamespace(item: KubeResource): string {
  return item.metadata?.namespace || "default";
}

export function getResourceCreatedAt(item: KubeResource): string {
  return item.metadata?.creationTimestamp || "-";
}
