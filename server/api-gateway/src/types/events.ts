export interface LegacyEventItem {
  name: string;
  namespace: string;
  type: string;
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    name: string;
  };
  count: number;
  lastTimestamp: string;
}
