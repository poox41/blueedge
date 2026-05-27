import type { DeviceModelView, KubeResource } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace } from "./common";

export function normalizeDeviceModel(raw: KubeResource): DeviceModelView {
  const properties = (raw.spec?.properties || raw.spec?.propertyVisitors || []) as unknown[];
  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    propertiesCount:
      typeof raw.properties === "number"
        ? raw.properties
        : Array.isArray(properties)
          ? properties.length
          : 0,
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeDeviceModelList(payload: unknown): DeviceModelView[] {
  return asItems<KubeResource>(payload).map(normalizeDeviceModel);
}
