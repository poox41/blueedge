import { bffRequest } from "@/api/request";
import { normalizeDeploymentList } from "@/api/adapters/deployment.adapter";
import { normalizeDeviceList } from "@/api/adapters/device.adapter";
import { normalizeDeviceModelList } from "@/api/adapters/device-model.adapter";
import { normalizeNodeList } from "@/api/adapters/node.adapter";
import { normalizeRuleList } from "@/api/adapters/rule.adapter";
import type { DeviceModelView, DeviceView, EdgeNodeView, RuleView, WorkloadView } from "@/types/kubeedge";

export async function listNodes(): Promise<EdgeNodeView[]> {
  const res = await bffRequest<unknown>("/node");
  return normalizeNodeList(res.data);
}

export async function listDeployments(namespace?: string): Promise<WorkloadView[]> {
  const path = namespace ? `/deployment/${namespace}` : "/deployment";
  const res = await bffRequest<unknown>(path);
  return normalizeDeploymentList(res.data);
}

export async function listDeviceModels(namespace?: string): Promise<DeviceModelView[]> {
  const path = namespace ? `/devicemodel/${namespace}` : "/devicemodel";
  const res = await bffRequest<unknown>(path);
  return normalizeDeviceModelList(res.data);
}

export async function listDevices(namespace?: string): Promise<DeviceView[]> {
  const path = namespace ? `/device/${namespace}` : "/device";
  const res = await bffRequest<unknown>(path);
  return normalizeDeviceList(res.data);
}

export async function listRules(namespace?: string): Promise<RuleView[]> {
  const path = namespace ? `/rule/${namespace}` : "/rule";
  const res = await bffRequest<unknown>(path);
  return normalizeRuleList(res.data);
}
