export interface StorageCrudPayload {
  metadata?: {
    namespace?: string;
    [key: string]: any;
  };
  [key: string]: any;
}
