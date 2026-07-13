export interface DeviceModelSummaryProperty {
  name: string;
  type: string;
  accessMode: string;
  unit?: string;
  minimum?: unknown;
  maximum?: unknown;
  defaultValue?: unknown;
  description?: string;
}

export interface DeviceModelSummary {
  name: string;
  namespace: string;
  description: string;
  protocol: string;
  properties: DeviceModelSummaryProperty[];
  devices: {
    total: number;
    online: number;
    offline: number;
    unknown: number;
  };
  createdAt: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  rawRef: {
    kind: "DeviceModel";
    namespace: string;
    name: string;
  };
  raw?: any;
}

export interface DeviceModelSummaryListResponse {
  items: DeviceModelSummary[];
  warnings?: Array<{ source: string; code?: string; message: string }>;
}

export interface DeviceModelSummaryResponse {
  item: DeviceModelSummary;
  warnings?: Array<{ source: string; code?: string; message: string }>;
}
