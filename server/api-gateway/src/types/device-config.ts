export interface DevicePropertyInput {
  propertyName: string;
  desiredValue?: string;
  collectIntervalSeconds: number;
  reportIntervalSeconds: number;
  accessConfigYaml: string;
}

export interface DeviceConfigRequest {
  name: string;
  namespace: string;
  deviceModelRef: string;
  nodeName?: string;
  protocol: string;
  description?: string;
  labels?: Record<string, string>;
  accessConfigYaml: string;
  properties: DevicePropertyInput[];
}

export interface DeviceExtensionConfig {
  storage: "configMap";
  configMapName: string;
  accessConfigYaml: string;
  twinAccessConfigs: Record<string, string>;
}
