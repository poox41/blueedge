import type { EdgeUnitWarning } from "./warnings.js";

export interface EdgeUnitAuxSources {
  nodes: any[];
  pods: any[];
  deployments: any[];
  edgeApplications: any[];
  accessConfigs: any[];
}

export interface NodeGroupDetails {
  nodeGroups: any[];
  nodeGroupError: unknown | null;
  nodeGroupByName: Map<string, any>;
}

export interface EdgeUnitSources extends NodeGroupDetails {
  edgeUnitConfigMaps: any[];
  aux: EdgeUnitAuxSources;
}

export interface WarningCollector {
  warnings: EdgeUnitWarning[];
}
