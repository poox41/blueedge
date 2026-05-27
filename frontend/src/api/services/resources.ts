import { bffRequest } from "@/api/request";
import { asItems } from "@/api/adapters/common";
import { normalizeDeploymentList } from "@/api/adapters/deployment.adapter";
import { normalizeDeviceList } from "@/api/adapters/device.adapter";
import { normalizeDeviceModelList } from "@/api/adapters/device-model.adapter";
import { normalizeNodeList } from "@/api/adapters/node.adapter";
import { normalizeRuleList } from "@/api/adapters/rule.adapter";
import { normalizeRuleEndpointList } from "@/api/adapters/rule-endpoint.adapter";
import { normalizeServiceList } from "@/api/adapters/service.adapter";
import type {
  DeviceModelView,
  DeviceView,
  EdgeNodeView,
  RuleEndpointView,
  RuleView,
  ServiceView,
  WorkloadView,
} from "@/types/kubeedge";

export async function listNodes(): Promise<EdgeNodeView[]> {
  const res = await bffRequest<unknown>("/node");
  return normalizeNodeList(res.data);
}

export async function listNamespaces(): Promise<Array<{ value: string; label: string }>> {
  const res = await bffRequest<unknown>("/namespace");
  const items = Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
  return [
    { value: "all", label: "全部命名空间" },
    ...items.map((item: any) => {
      const name = item?.metadata?.name || item?.name || "-";
      return { value: name, label: name };
    }),
  ];
}

export async function listDeployments(namespace?: string): Promise<WorkloadView[]> {
  const path = namespace ? `/deployment/${namespace}` : "/deployment";
  const res = await bffRequest<unknown>(path);
  return normalizeDeploymentList(res.data);
}

export async function getDeployment(namespace: string, name: string): Promise<WorkloadView> {
  const res = await bffRequest<unknown>(`/deployment/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`);
  return normalizeDeploymentList([res.data])[0];
}

export async function listPods(namespace?: string): Promise<any[]> {
  const path = namespace ? `/pod/${namespace}` : "/pod";
  const res = await bffRequest<unknown>(path);
  return asItems(res.data);
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

export async function listServices(namespace?: string): Promise<ServiceView[]> {
  const path = namespace ? `/service/${namespace}` : "/service";
  const res = await bffRequest<unknown>(path);
  return normalizeServiceList(res.data);
}

export async function listRuleEndpoints(namespace?: string): Promise<RuleEndpointView[]> {
  const path = namespace ? `/ruleendpoint/${namespace}` : "/ruleendpoint";
  const res = await bffRequest<unknown>(path);
  return normalizeRuleEndpointList(res.data);
}

export async function listRules(namespace?: string): Promise<RuleView[]> {
  const path = namespace ? `/rule/${namespace}` : "/rule";
  const res = await bffRequest<unknown>(path);
  return normalizeRuleList(res.data);
}

export async function listNodeGroups(): Promise<any[]> {
  const res = await bffRequest<unknown>("/nodegroup");
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function getNodeGroup(name: string): Promise<any> {
  const res = await bffRequest<unknown>(`/nodegroup/${encodeURIComponent(name)}`);
  return res.data;
}

export async function listEdgeApplications(namespace?: string): Promise<any[]> {
  const path = namespace ? `/edgeapplication/${namespace}` : "/edgeapplication";
  const res = await bffRequest<unknown>(path);
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function listClusterRoles(): Promise<any[]> {
  const res = await bffRequest<unknown>("/clusterrole");
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function listClusterRoleBindings(): Promise<any[]> {
  const res = await bffRequest<unknown>("/clusterrolebinding");
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function listRoles(namespace?: string): Promise<any[]> {
  const path = namespace ? `/role/${namespace}` : "/role";
  const res = await bffRequest<unknown>(path);
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function listRoleBindings(namespace?: string): Promise<any[]> {
  const path = namespace ? `/rolebinding/${namespace}` : "/rolebinding";
  const res = await bffRequest<unknown>(path);
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function listServiceAccounts(namespace?: string): Promise<any[]> {
  const path = namespace ? `/serviceaccount/${namespace}` : "/serviceaccount";
  const res = await bffRequest<unknown>(path);
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function listCRDs(): Promise<any[]> {
  const res = await bffRequest<unknown>("/crd");
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}
