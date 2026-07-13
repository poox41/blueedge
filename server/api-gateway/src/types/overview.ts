export interface LegacyOverview {
  nodes: { total: number; ready: number; edge: number };
  workloads: { deployments: number; running: number };
  devices: { total: number; online: number };
  rules: { total: number };
}
