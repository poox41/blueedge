export interface AccessConfigCommandView {
  name: string;
  ready: boolean;
  prepareCommand: string;
  command: string;
  commandTemplate: string;
  missingRequirements: string[];
  expiresAt: string | null;
  warnings?: unknown[];
}

export interface AccessConfigPayload {
  name?: string;
  edgeUnitRef: string;
  nodeName?: string;
  cloudCoreAddress: string;
  protocol?: "https" | "websocket" | "quic";
  driver?: "systemd" | "cgroups";
  criAddress?: string;
  registry?: string;
  description?: string;
  labels?: Record<string, string>;
}
