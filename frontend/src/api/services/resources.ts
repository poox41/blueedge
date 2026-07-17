import { bffRequest, gatewayRequest } from "@/api/request";
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
  KubeResource,
  RuleEndpointView,
  RuleView,
  ServiceView,
  WorkloadView,
} from "@/types/kubeedge";

type NamespacedResourceKind =
  | "deployment"
  | "pod"
  | "configmap"
  | "secret"
  | "service"
  | "device"
  | "devicemodel"
  | "rule"
  | "ruleendpoint"
  | "role"
  | "rolebinding"
  | "serviceaccount"
  | "edgeapplication";

type ClusterResourceKind = "node" | "nodegroup" | "clusterrole" | "clusterrolebinding";

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

export async function createNamespacedResource<T extends KubeResource = KubeResource>(
  kind: NamespacedResourceKind,
  namespace: string,
  resource: T,
): Promise<T> {
  const res = await bffRequest<T, T>(`/${kind}/${encodePathPart(namespace)}`, {
    method: "POST",
    body: resource,
  });
  return res.data;
}

export async function updateNamespacedResource<T extends KubeResource = KubeResource>(
  kind: NamespacedResourceKind,
  namespace: string,
  resource: T,
): Promise<T> {
  const res = await bffRequest<T, T>(`/${kind}/${encodePathPart(namespace)}`, {
    method: "PUT",
    body: resource,
  });
  return res.data;
}

export async function deleteNamespacedResource(
  kind: NamespacedResourceKind,
  namespace: string,
  name: string,
): Promise<void> {
  await bffRequest(`/${kind}/${encodePathPart(namespace)}/${encodePathPart(name)}`, {
    method: "DELETE",
  });
}

export async function createClusterResource<T extends KubeResource = KubeResource>(
  kind: ClusterResourceKind,
  resource: T,
): Promise<T> {
  const res = await bffRequest<T, T>(`/${kind}`, {
    method: "POST",
    body: resource,
  });
  return res.data;
}

export async function updateClusterResource<T extends KubeResource = KubeResource>(
  kind: ClusterResourceKind,
  resource: T,
): Promise<T> {
  const res = await bffRequest<T, T>(`/${kind}`, {
    method: "PUT",
    body: resource,
  });
  return res.data;
}

export async function deleteClusterResource(kind: ClusterResourceKind, name: string): Promise<void> {
  await bffRequest(`/${kind}/${encodePathPart(name)}`, {
    method: "DELETE",
  });
}

export const resourceWrites = {
  createNamespaced: createNamespacedResource,
  updateNamespaced: updateNamespacedResource,
  deleteNamespaced: deleteNamespacedResource,
  createCluster: createClusterResource,
  updateCluster: updateClusterResource,
  deleteCluster: deleteClusterResource,
};

export async function listNodes(): Promise<EdgeNodeView[]> {
  const res = await bffRequest<unknown>("/node");
  return normalizeNodeList(res.data);
}

export async function getNode(name: string): Promise<EdgeNodeView> {
  const res = await bffRequest<unknown>(`/node/${encodePathPart(name)}`);
  return normalizeNodeList([res.data])[0];
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
  const items: WorkloadView[] = [];
  let page = 1;

  while (page <= 100) {
    const result = await listDeploymentPage(namespace, { page, pageSize: 100 });
    items.push(...result.items);
    if (!result.hasNext || result.items.length === 0) return items;
    page += 1;
  }

  throw new Error("Deployment 列表分页超过安全上限");
}

export interface DeploymentListOptions {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface DeploymentListResult {
  items: WorkloadView[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export async function listDeploymentPage(namespace?: string, options: DeploymentListOptions = {}): Promise<DeploymentListResult> {
  const path = namespace ? `/deployment/${namespace}` : "/deployment";
  const search = options.search?.trim();
  const res = await bffRequest<{
    items?: unknown[];
    total?: number;
    page?: number;
    pageSize?: number;
    hasNext?: boolean;
  }>(path, {
    params: {
      page: options.page || 1,
      pageSize: options.pageSize || 20,
      sort: "creationTimestamp",
      order: "desc",
      filter: search ? `name:*${search}*` : undefined,
    },
  });

  return {
    items: normalizeDeploymentList(res.data),
    total: Number(res.data?.total ?? res.data?.items?.length ?? 0),
    page: Number(res.data?.page ?? options.page ?? 1),
    pageSize: Number(res.data?.pageSize ?? options.pageSize ?? 20),
    hasNext: Boolean(res.data?.hasNext),
  };
}

export async function getDeployment(namespace: string, name: string): Promise<WorkloadView> {
  const res = await bffRequest<unknown>(`/deployment/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return normalizeDeploymentList([res.data])[0];
}

export async function createDeploymentResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("deployment", resource.metadata?.namespace || "default", resource);
}

export async function createEdgeUnitDeploymentResource(edgeUnitName: string, resource: KubeResource): Promise<KubeResource> {
  const res = await gatewayRequest<KubeResource, KubeResource>(`/blueedge/edge-units/${encodePathPart(edgeUnitName)}/deployments`, {
    method: "POST",
    body: resource,
  });
  return res.data;
}

export async function updateEdgeUnitDeploymentResource(edgeUnitName: string, namespace: string, name: string, resource: KubeResource): Promise<KubeResource> {
  const res = await gatewayRequest<KubeResource, KubeResource>(`/blueedge/edge-units/${encodePathPart(edgeUnitName)}/deployments/${encodePathPart(namespace)}/${encodePathPart(name)}`, {
    method: "PUT",
    body: resource,
  });
  return res.data;
}

export async function updateDeploymentResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("deployment", namespace, resource);
}

export async function deleteDeploymentResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("deployment", namespace, name);
}

export async function updateNodeResource(resource: KubeResource): Promise<KubeResource> {
  return updateClusterResource("node", resource);
}

export async function deleteNodeResource(name: string): Promise<void> {
  return deleteClusterResource("node", name);
}

export async function listPods(namespace?: string): Promise<any[]> {
  try {
    const path = namespace ? `/pod/${namespace}` : "/pod";
    const res = await bffRequest<unknown>(path);
    return asItems(res.data);
  } catch {
    const res = await gatewayRequest<unknown>("/workloads/pods", {
      params: { namespace },
    });
    return asItems(res.data);
  }
}

export async function deletePodResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("pod", namespace, name);
}

export async function listConfigMaps(namespace?: string): Promise<any[]> {
  const path = namespace ? `/configmap/${namespace}` : "/configmap";
  const res = await bffRequest<unknown>(path);
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function getConfigMap(namespace: string, name: string): Promise<any> {
  const res = await bffRequest<unknown>(`/configmap/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return res.data;
}

export async function createConfigMapResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("configmap", resource.metadata?.namespace || "default", resource);
}

export async function updateConfigMapResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("configmap", namespace, resource);
}

export async function deleteConfigMapResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("configmap", namespace, name);
}

export async function listSecrets(namespace?: string): Promise<any[]> {
  const path = namespace ? `/secret/${namespace}` : "/secret";
  const res = await bffRequest<unknown>(path);
  return Array.isArray((res.data as any)?.items) ? (res.data as any).items : [];
}

export async function getSecret(namespace: string, name: string): Promise<any> {
  const res = await bffRequest<unknown>(`/secret/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return res.data;
}

export async function createSecretResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("secret", resource.metadata?.namespace || "default", resource);
}

export async function updateSecretResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("secret", namespace, resource);
}

export async function deleteSecretResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("secret", namespace, name);
}

export async function listDeviceModels(namespace?: string): Promise<DeviceModelView[]> {
  const path = namespace ? `/devicemodel/${namespace}` : "/devicemodel";
  const res = await bffRequest<unknown>(path);
  return normalizeDeviceModelList(res.data);
}

export async function getDeviceModel(namespace: string, name: string): Promise<DeviceModelView> {
  const res = await bffRequest<unknown>(`/devicemodel/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return normalizeDeviceModelList([res.data])[0];
}

export async function listDevices(namespace?: string): Promise<DeviceView[]> {
  const path = namespace ? `/device/${namespace}` : "/device";
  const res = await bffRequest<unknown>(path);
  return normalizeDeviceList(res.data);
}

export async function getDevice(namespace: string, name: string): Promise<DeviceView> {
  const res = await bffRequest<unknown>(`/device/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return normalizeDeviceList([res.data])[0];
}

export async function listServices(namespace?: string): Promise<ServiceView[]> {
  const path = namespace ? `/service/${namespace}` : "/service";
  const res = await bffRequest<unknown>(path);
  return normalizeServiceList(res.data);
}

export async function getService(namespace: string, name: string): Promise<ServiceView> {
  const res = await bffRequest<unknown>(`/service/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return normalizeServiceList([res.data])[0];
}

export async function createServiceResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("service", resource.metadata?.namespace || "default", resource);
}

export async function updateServiceResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("service", namespace, resource);
}

export async function deleteServiceResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("service", namespace, name);
}

export async function createDeviceModelResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("devicemodel", resource.metadata?.namespace || "default", resource);
}

export async function updateDeviceModelResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("devicemodel", namespace, resource);
}

export async function deleteDeviceModelResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("devicemodel", namespace, name);
}

export async function createDeviceResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("device", resource.metadata?.namespace || "default", resource);
}

export async function updateDeviceResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("device", namespace, resource);
}

export async function deleteDeviceResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("device", namespace, name);
}

export async function createRuleEndpointResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("ruleendpoint", resource.metadata?.namespace || "default", resource);
}

export async function updateRuleEndpointResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("ruleendpoint", namespace, resource);
}

export async function deleteRuleEndpointResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("ruleendpoint", namespace, name);
}

export async function createRuleResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("rule", resource.metadata?.namespace || "default", resource);
}

export async function updateRuleResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("rule", namespace, resource);
}

export async function deleteRuleResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("rule", namespace, name);
}

export async function createServiceAccountResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("serviceaccount", resource.metadata?.namespace || "default", resource);
}

export async function updateServiceAccountResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("serviceaccount", namespace, resource);
}

export async function deleteServiceAccountResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("serviceaccount", namespace, name);
}

export async function createRoleResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("role", resource.metadata?.namespace || "default", resource);
}

export async function updateRoleResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("role", namespace, resource);
}

export async function deleteRoleResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("role", namespace, name);
}

export async function createRoleBindingResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("rolebinding", resource.metadata?.namespace || "default", resource);
}

export async function updateRoleBindingResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("rolebinding", namespace, resource);
}

export async function deleteRoleBindingResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("rolebinding", namespace, name);
}

export async function createEdgeApplicationResource(resource: KubeResource): Promise<KubeResource> {
  return createNamespacedResource("edgeapplication", resource.metadata?.namespace || "default", resource);
}

export async function updateEdgeApplicationResource(namespace: string, resource: KubeResource): Promise<KubeResource> {
  return updateNamespacedResource("edgeapplication", namespace, resource);
}

export async function deleteEdgeApplicationResource(namespace: string, name: string): Promise<void> {
  return deleteNamespacedResource("edgeapplication", namespace, name);
}

export async function createNodeGroupResource(resource: KubeResource): Promise<KubeResource> {
  return createClusterResource("nodegroup", resource);
}

export async function updateNodeGroupResource(resource: KubeResource): Promise<KubeResource> {
  return updateClusterResource("nodegroup", resource);
}

export async function deleteNodeGroupResource(name: string): Promise<void> {
  return deleteClusterResource("nodegroup", name);
}

export async function createClusterRoleResource(resource: KubeResource): Promise<KubeResource> {
  return createClusterResource("clusterrole", resource);
}

export async function updateClusterRoleResource(resource: KubeResource): Promise<KubeResource> {
  return updateClusterResource("clusterrole", resource);
}

export async function deleteClusterRoleResource(name: string): Promise<void> {
  return deleteClusterResource("clusterrole", name);
}

export async function createClusterRoleBindingResource(resource: KubeResource): Promise<KubeResource> {
  return createClusterResource("clusterrolebinding", resource);
}

export async function updateClusterRoleBindingResource(resource: KubeResource): Promise<KubeResource> {
  return updateClusterResource("clusterrolebinding", resource);
}

export async function deleteClusterRoleBindingResource(name: string): Promise<void> {
  return deleteClusterResource("clusterrolebinding", name);
}

export async function listRuleEndpoints(namespace?: string): Promise<RuleEndpointView[]> {
  const path = namespace ? `/ruleendpoint/${namespace}` : "/ruleendpoint";
  const res = await bffRequest<unknown>(path);
  return normalizeRuleEndpointList(res.data);
}

export async function getRuleEndpoint(namespace: string, name: string): Promise<RuleEndpointView> {
  const res = await bffRequest<unknown>(`/ruleendpoint/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return normalizeRuleEndpointList([res.data])[0];
}

export async function listRules(namespace?: string): Promise<RuleView[]> {
  const path = namespace ? `/rule/${namespace}` : "/rule";
  const res = await bffRequest<unknown>(path);
  return normalizeRuleList(res.data);
}

export async function getRule(namespace: string, name: string): Promise<RuleView> {
  const res = await bffRequest<unknown>(`/rule/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return normalizeRuleList([res.data])[0];
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

export async function getEdgeApplication(namespace: string, name: string): Promise<any> {
  const res = await bffRequest<unknown>(`/edgeapplication/${encodePathPart(namespace)}/${encodePathPart(name)}`);
  return res.data;
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

export async function getCRD(name: string): Promise<any> {
  const res = await bffRequest<unknown>(`/crd/${encodePathPart(name)}`);
  return res.data;
}
