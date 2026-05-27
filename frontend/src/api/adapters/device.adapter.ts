import type { DeviceView, KubeResource } from "@/types/kubeedge";
import { asItems, getCreatedAt, getName, getNamespace, getNestedString } from "./common";

export function normalizeDevice(raw: KubeResource): DeviceView {
  return {
    name: getName(raw),
    namespace: getNamespace(raw),
    model:
      typeof raw.model === "string"
        ? raw.model
        : getNestedString(raw, ["spec", "deviceModelRef", "name"]),
    nodeName:
      typeof raw.nodeName === "string"
        ? raw.nodeName
        : getNestedString(raw, ["spec", "nodeName"]),
    status:
      typeof (raw as Record<string, unknown>).status === "string"
        ? String((raw as Record<string, unknown>).status)
        : getNestedString(raw, ["status", "state"], "Unknown"),
    createdAt: getCreatedAt(raw),
    raw,
  };
}

export function normalizeDeviceList(payload: unknown): DeviceView[] {
  return asItems<KubeResource>(payload).map(normalizeDevice);
}
