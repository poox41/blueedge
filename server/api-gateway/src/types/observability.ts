export type ObservabilityKind = "node" | "pod" | "deployment" | "edgeapplication" | "device";

export interface ObservabilityQuery {
  includeMetrics?: unknown;
  includeEvents?: unknown;
  includeLogs?: unknown;
  container?: unknown;
  pod?: unknown;
  tailLines?: unknown;
  sinceSeconds?: unknown;
  previous?: unknown;
}
