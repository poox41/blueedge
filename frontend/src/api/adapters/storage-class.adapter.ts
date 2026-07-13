export interface StorageClassSummary {
  name: string;
  provisioner: string;
  reclaimPolicy: string;
  volumeBindingMode: string;
  allowVolumeExpansion: boolean;
  isDefault: boolean;
  parameters: Record<string, string>;
}

export interface StorageClassListResponse {
  items: StorageClassSummary[];
  warnings?: Array<{ source: string; message: string }>;
}
