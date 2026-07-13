import type { EdgeUnitWarning } from "./warnings.js";

export interface ResourceSummaryResult {
  item: Record<string, any>;
  warnings?: EdgeUnitWarning[];
}
