export interface AccessConfigCommandView {
  name: string;
  ready: boolean;
  command: string;
  commandTemplate: string;
  missingRequirements: string[];
  expiresAt: null;
  warnings?: unknown[];
}
