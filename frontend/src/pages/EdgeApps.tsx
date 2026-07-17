import { useCallback, useEffect, useMemo, useState } from "react";
import { useNamespace } from "@/contexts/NamespaceContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ListPagination } from "@/components/common/ListPagination";
import {
  Search,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  Eye,
  Copy,
  Server,
  Cpu,
  MemoryStick,
  Activity,
  Filter,
  Pencil,
} from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { getResourceCreatedAt, getResourceName, getResourceNamespace } from "@/api/adapters/kube-resource.adapter";
import { edgeAppSummaryStatusText } from "@/api/adapters/edgeapp-summary.adapter";
import { createEdgeApplicationResource, deleteEdgeApplicationResource, getDeployment, getEdgeApplication, listEdgeApplications, listNodeGroups, updateEdgeApplicationResource } from "@/api/services/resources";
import { getEdgeAppSummary, getEdgeUnitResources, getResourceLogs } from "@/api/services/product";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import type { KubeResource } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import yaml from "js-yaml";
import { ContainerEditor } from "@/components/edge-app/ContainerEditor";
import { VolumeEditor } from "@/components/edge-app/VolumeEditor";
import { EdgeAppCreateWizard } from "@/components/edge-app/EdgeAppCreateWizard";
import { buildEdgeApplicationResource, emptyContainer } from "@/components/edge-app/container-model";
import type { ContainerForm, EdgeApplicationForm, VolumeForm } from "@/components/edge-app/container-model";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";

interface EdgeApp {
  namespace: string;
  name: string;
  type: string;
  status: string;
  statusColor: string;
  node: string;
  nodeRole: string;
  images: string[];
  cpu: string;
  memory: string;
  cpuLimit: string;
  memoryLimit: string;
  restartCount: number;
  pods: string;
  ports: string[];
  createdAt: string;
  age: string;
  labels: Record<string, string>;
  selector?: Record<string, string>;
  strategy?: string;
  desiredReplicas?: number;
  availableReplicas?: number;
  completion?: string;
  duration?: string;
  desired?: number;
  current?: number;
  ready?: number;
  ip?: string;
  raw: KubeResource;
}

function assignEdgeApplicationToEdgeUnit(resource: KubeResource, edgeUnitName: string): KubeResource {
  const next = JSON.parse(JSON.stringify(resource)) as KubeResource;
  next.metadata = {
    ...next.metadata,
    labels: { ...(next.metadata?.labels || {}), "blueedge.io/edge-unit": edgeUnitName },
  };
  const manifests = (next.spec as any)?.workloadTemplate?.manifests;
  if (Array.isArray(manifests)) {
    manifests.forEach((manifest: any) => {
      manifest.metadata = {
        ...(manifest.metadata || {}),
        labels: { ...(manifest.metadata?.labels || {}), "blueedge.io/edge-unit": edgeUnitName },
      };
      if (manifest.spec?.template) {
        manifest.spec.template.metadata = {
          ...(manifest.spec.template.metadata || {}),
          labels: { ...(manifest.spec.template.metadata?.labels || {}), "blueedge.io/edge-unit": edgeUnitName },
        };
      }
    });
  }
  return next;
}

const typeColors: Record<string, string> = {
  Deployment: "bg-[var(--color-brand-light)] text-[var(--color-brand)]",
  Job: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  Pod: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  DaemonSet: "bg-[#F5E8FF] text-[#722ED1]",
};

const typeIcons: Record<string, React.ElementType> = {
  Deployment: Server,
  Job: Activity,
  Pod: Cpu,
  DaemonSet: MemoryStick,
};

const defaultTargetNodeGroupName = "edge-group";
const k8sNamePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function isValidK8sName(name: string): boolean {
  return k8sNamePattern.test(name) && name.length <= 63;
}

function parseSimpleYaml(input: string): KubeResource {
  const jsonLike = input.trim();
  if (!jsonLike) throw new Error("请粘贴 EdgeApplication YAML");
  return (jsonLike.startsWith("{") ? JSON.parse(jsonLike) : yaml.load(input)) as KubeResource;
}

function validateEdgeApplicationResource(resource: KubeResource): KubeResource {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new Error("YAML 内容必须是 Kubernetes 资源对象");
  }
  if (resource.kind !== "EdgeApplication") {
    throw new Error("当前入口只支持创建 kind: EdgeApplication");
  }
  if (!resource.metadata?.name) {
    throw new Error("EdgeApplication YAML 缺少 metadata.name");
  }
  if (!Array.isArray((resource.spec?.workloadTemplate as any)?.manifests)) {
    throw new Error("EdgeApplication YAML 缺少 spec.workloadTemplate.manifests");
  }
  return {
    ...resource,
    metadata: {
      ...(resource.metadata || {}),
      namespace: resource.metadata?.namespace || "default",
    },
  };
}

function getWorkloadManifest(item: any): any {
  const manifest = item?.spec?.workloadTemplate?.manifests?.[0];
  if (manifest) return manifest;

  const legacyTemplate = item?.spec?.workloadTemplate;
  if (legacyTemplate?.kind || legacyTemplate?.spec) {
    return {
      apiVersion: legacyTemplate.apiVersion,
      kind: legacyTemplate.kind,
      metadata: item?.metadata,
      spec: legacyTemplate.spec,
    };
  }

  return item;
}

function getFirstContainer(item: any): any {
  const workload = getWorkloadManifest(item);
  const containers =
    workload?.spec?.template?.spec?.containers ||
    workload?.spec?.containers;
  return Array.isArray(containers) ? containers[0] : undefined;
}

function toEdgeApp(item: any): EdgeApp {
  const workload = getWorkloadManifest(item);
  const labels = workload?.metadata?.labels || workload?.spec?.selector?.matchLabels || item?.metadata?.labels || {};
  const container = getFirstContainer(item) || {};
  const replicas = workload?.spec?.replicas ?? item?.spec?.replicas ?? 1;
  const workloadStatus = Array.isArray(item?.status?.workloadStatus) ? item.status.workloadStatus : [];
  const isAvailable = workloadStatus.some((s: any) => s?.conditions === "Available");
  const availableReplicas = item?.status?.availableReplicas ?? item?.status?.readyReplicas ?? (isAvailable ? replicas : 0);
  const kind = workload?.kind || item?.spec?.workloadTemplate?.kind || item?.kind || "Deployment";
  const phase = item?.status?.phase || (workloadStatus.length ? (isAvailable ? "运行中" : "处理中") : undefined);
  const status = item?.spec?.paused ? "已暂停" : phase || (availableReplicas >= replicas ? "运行中" : "未就绪");
  const targetNodeGroups = item?.spec?.workloadScope?.targetNodeGroups;
  const targetNodeLabels = item?.spec?.workloadScope?.targetNodeLabels;

  return {
    namespace: getResourceNamespace(item),
    name: getResourceName(item),
    type: kind,
    status,
    statusColor: status === "运行中" || status === "Running" || status === "Succeeded" ? "success" : "warning",
    node:
      item?.nodeGroups ||
      (Array.isArray(targetNodeGroups) && targetNodeGroups.length
        ? targetNodeGroups.map((group: any) => typeof group === "string" ? group : group?.name).filter(Boolean).join(", ")
        : "") ||
      (Array.isArray(targetNodeLabels) && targetNodeLabels.length ? "按节点标签" : "-"),
    nodeRole: "edge",
    images: [container?.image || "-"],
    cpu: "0",
    memory: "0Mi",
    cpuLimit: container?.resources?.limits?.cpu || "-",
    memoryLimit: container?.resources?.limits?.memory || "-",
    restartCount: 0,
    pods: `${availableReplicas}/${replicas}`,
    ports: Array.isArray(container?.ports) ? container.ports.map((p: any) => `${p.containerPort}/${p.protocol || "TCP"}`) : [],
    createdAt: getResourceCreatedAt(item),
    age: getResourceCreatedAt(item),
    labels,
    selector: workload?.spec?.selector?.matchLabels,
    strategy: workload?.spec?.strategy?.type,
    desiredReplicas: replicas,
    availableReplicas,
    desired: item?.status?.desiredNumberScheduled,
    current: item?.status?.currentNumberScheduled,
    ready: item?.status?.numberReady,
    ip: item?.status?.podIP,
    raw: item,
  };
}

interface ContainedResourceRef {
  kind?: string;
  namespace?: string;
  name?: string;
}

function getContainedResourceRefs(item: KubeResource): ContainedResourceRef[] {
  const value = item.metadata?.annotations?.["apps.kubeedge.io/last-contained-resources"];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function resolveEdgeAppRuntimeStatus(item: KubeResource, row: EdgeApp): Promise<EdgeApp> {
  if (!["处理中", "Processing", "未就绪"].includes(row.status)) return row;
  const deploymentRef = getContainedResourceRefs(item).find((ref) => ref.kind === "Deployment" && ref.name);
  if (!deploymentRef?.name) return row;

  try {
    const deployment = await getDeployment(deploymentRef.namespace || row.namespace, deploymentRef.name);
    const desired = deployment.replicas || row.desiredReplicas || 1;
    const available = deployment.availableReplicas || 0;
    if (desired > 0 && available >= desired) {
      return {
        ...row,
        status: "运行中",
        statusColor: "success",
        pods: `${available}/${desired}`,
        desiredReplicas: desired,
        availableReplicas: available,
      };
    }
  } catch {
    // Keep the EdgeApplication controller status when the contained resource cannot be read.
  }
  return row;
}

function updateFirstContainer(raw: KubeResource, updates: Record<string, unknown>): KubeResource {
  const spec = { ...(raw.spec || {}) } as Record<string, any>;
  const manifests = Array.isArray(spec.workloadTemplate?.manifests) ? [...spec.workloadTemplate.manifests] : [];
  const manifest = manifests[0];
  const template = manifest?.spec?.template || spec.template || spec;
  const podSpec = template?.spec || spec;
  const containers = Array.isArray(podSpec?.containers) ? [...podSpec.containers] : [];
  containers[0] = { ...(containers[0] || {}), ...updates };

  if (manifest?.spec?.template?.spec) {
    manifests[0] = {
      ...manifest,
      spec: {
        ...manifest.spec,
        template: {
          ...manifest.spec.template,
          spec: {
            ...manifest.spec.template.spec,
            containers,
          },
        },
      },
    };
    spec.workloadTemplate = {
      ...spec.workloadTemplate,
      manifests,
    };
  } else if (spec.workloadTemplate?.spec?.template?.spec) {
    spec.workloadTemplate = {
      ...spec.workloadTemplate,
      spec: {
        ...spec.workloadTemplate.spec,
        template: {
          ...spec.workloadTemplate.spec.template,
          spec: {
            ...spec.workloadTemplate.spec.template.spec,
            containers,
          },
        },
      },
    };
  } else if (spec.template?.spec) {
    spec.template = {
      ...spec.template,
      spec: {
        ...spec.template.spec,
        containers,
      },
    };
  } else {
    spec.containers = containers;
  }

  return { ...raw, spec };
}

function updateWorkloadTemplateMetadata(raw: KubeResource, annotations: Record<string, string>): KubeResource {
  const spec = { ...(raw.spec || {}) } as Record<string, any>;
  const manifests = Array.isArray(spec.workloadTemplate?.manifests) ? [...spec.workloadTemplate.manifests] : [];
  const manifest = manifests[0];
  if (manifest?.spec?.template) {
    const template = manifest.spec.template;
    manifests[0] = {
      ...manifest,
      spec: {
        ...manifest.spec,
        template: {
          ...template,
          metadata: {
            ...(template.metadata || {}),
            annotations: {
              ...(template.metadata?.annotations || {}),
              ...annotations,
            },
          },
        },
      },
    };
    spec.workloadTemplate = {
      ...spec.workloadTemplate,
      manifests,
    };
  } else if (spec.workloadTemplate?.spec?.template) {
    const template = spec.workloadTemplate.spec.template;
    spec.workloadTemplate = {
      ...spec.workloadTemplate,
      spec: {
        ...spec.workloadTemplate.spec,
        template: {
          ...template,
          metadata: {
            ...(template.metadata || {}),
            annotations: {
              ...(template.metadata?.annotations || {}),
              ...annotations,
            },
          },
        },
      },
    };
  } else if (spec.template) {
    spec.template = {
      ...spec.template,
      metadata: {
        ...(spec.template.metadata || {}),
        annotations: {
          ...(spec.template.metadata?.annotations || {}),
          ...annotations,
        },
      },
    };
  } else {
    spec.template = {
      metadata: { annotations },
    };
  }
  return { ...raw, spec };
}

function exportableEdgeApplicationYaml(a: EdgeApp): string {
  const raw = a.raw || {};
  const annotations = Object.fromEntries(
    Object.entries(raw.metadata?.annotations || {})
      .filter(([key]) => key !== "apps.kubeedge.io/last-contained-resources"),
  );
  const resource: KubeResource = {
    apiVersion: raw.apiVersion || "apps.kubeedge.io/v1alpha1",
    kind: raw.kind || "EdgeApplication",
    metadata: {
      name: raw.metadata?.name || a.name,
      namespace: raw.metadata?.namespace || a.namespace,
      labels: raw.metadata?.labels,
      annotations: Object.keys(annotations).length ? annotations : undefined,
    },
    spec: raw.spec,
  };
  return yaml.dump(resource, { noRefs: true, noCompatMode: true, lineWidth: 120 });
}

export function EdgeApps() {
  const { selectedEdgeUnitName } = useEdgeUnits();
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<EdgeApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { selectedNamespace: namespace } = useNamespace();
  const [typeFilter, setTypeFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<EdgeApp | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<EdgeApp | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editItem, setEditItem] = useState<EdgeApp | null>(null);
  const [detailLogs, setDetailLogs] = useState("打开日志页后加载关联 Pod 日志");
  const [detailLogWarning, setDetailLogWarning] = useState("");
  const [editForm, setEditForm] = useState({ image: "", cpuLimit: "", memoryLimit: "", replicas: 1 });
  const [editImageError, setEditImageError] = useState("");
  const [nodeGroupOptions, setNodeGroupOptions] = useState<string[]>([defaultTargetNodeGroupName]);
  const [createMode, setCreateMode] = useState("form");
  const [yamlText, setYamlText] = useState(`apiVersion: apps.kubeedge.io/v1alpha1
kind: EdgeApplication
metadata:
  name: edge-nginx
  namespace: default
spec:
  workloadTemplate:
    manifests:
    - apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: edge-nginx
        namespace: default
        labels:
          app: edge-nginx
      spec:
        replicas: 1
        selector:
          matchLabels:
            app: edge-nginx
        template:
          metadata:
            labels:
              app: edge-nginx
          spec:
            hostNetwork: true
            dnsPolicy: ClusterFirstWithHostNet
            containers:
            - name: edge-nginx
              image: nginx:latest
              resources:
                limits:
                  cpu: 100m
                  memory: 128Mi
  workloadScope:
    targetNodeGroups:
    - name: ${defaultTargetNodeGroupName}
      overrides: {}`);

  const [form, setForm] = useState<EdgeApplicationForm>({
    name: "",
    namespace: "default",
    type: "Deployment",
    replicas: 1,
    targetNodeGroup: defaultTargetNodeGroupName,
    imagePullSecrets: "",
    containers: [emptyContainer("edge-app", "nginx:latest")],
    initContainers: [] as ContainerForm[],
    volumes: [] as VolumeForm[],
    hostNetwork: false,
    networkMode: "none",
    hostPID: false,
    hostIPC: false,
    shareProcessNamespace: false,
    dnsPolicy: "ClusterFirst",
    serviceAccountName: "",
    runtimeClassName: "",
    nodeSelectorText: "",
    terminationGracePeriodSeconds: "30",
    alias: "",
    description: "",
    workloadLabelsText: "",
    podLabelsText: "",
    workloadAnnotationsText: "",
    podAnnotationsText: "",
    strategyType: "RollingUpdate",
    maxUnavailable: "25%",
    maxSurge: "25%",
    revisionHistoryLimit: "10",
    minReadySeconds: "0",
    progressDeadlineSeconds: "600",
  });

  const [pageSize, setPageSize] = useState(10);

  const loadData = useCallback(async (preserveCurrentRows = false) => {
    if (preserveCurrentRows) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");
    try {
      if (!selectedEdgeUnitName) {
        setData([]);
        return;
      }
      const [allItems, scope] = await Promise.all([
        listEdgeApplications(namespace === "all" ? undefined : namespace),
        getEdgeUnitResources(selectedEdgeUnitName),
      ]);
      const allowed = new Set(scope.item.edgeApplications.map((item) => `${item.namespace}/${item.name}`));
      const items = allItems.filter((item) => allowed.has(`${getResourceNamespace(item)}/${getResourceName(item)}`));
      const rows = items.map(toEdgeApp);
      const detailedRows = await Promise.all(
        rows.map(async (row) => {
          if (!row.name || row.name === "-") return row;
          try {
            const detail = await getEdgeApplication(row.namespace, row.name);
            return await resolveEdgeAppRuntimeStatus(detail, toEdgeApp(detail));
          } catch {
            return row;
          }
        }),
      );
      setData(detailedRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载边缘应用失败");
    } finally {
      if (preserveCurrentRows) setIsRefreshing(false);
      else setIsLoading(false);
    }
  }, [namespace, selectedEdgeUnitName]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let mounted = true;
    listNodeGroups()
      .then((items) => {
        if (!mounted) return;
        const names = items
          .map((item: any) => item?.metadata?.name || item?.name)
          .filter(Boolean);
        setNodeGroupOptions(Array.from(new Set([defaultTargetNodeGroupName, ...names])));
      })
      .catch(() => {
        if (mounted) setNodeGroupOptions([defaultTargetNodeGroupName]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    let result = data;
    if (namespace !== "all") {
      result = result.filter((d) => d.namespace === namespace);
    }
    if (typeFilter !== "all") {
      result = result.filter((d) => d.type === typeFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(s) ||
          d.namespace.toLowerCase().includes(s) ||
          d.type.toLowerCase().includes(s) ||
          d.images.some((img) => img.toLowerCase().includes(s))
      );
    }
    return result;
  }, [data, namespace, typeFilter, search]);

  const start = (currentPage - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);
  const createName = form.name.trim();
  const generatedFormYaml = useMemo(() => yaml.dump(buildEdgeApplicationResource({ ...form, name: createName || "edge-app" }), { noRefs: true, noCompatMode: true, lineWidth: 120 }), [form, createName]);
  const createNameError = createName && !isValidK8sName(createName)
    ? "名称只能包含小写字母、数字和中划线，且首尾必须是字母或数字"
    : "";

  const openDetail = async (a: EdgeApp) => {
    setSelected(a);
    setDetailOpen(true);
    setDetailLogs("打开日志页后加载关联 Pod 日志");
    setDetailLogWarning("");
    try {
      const { item, warnings } = await getEdgeAppSummary(a.namespace, a.name);
      if (warnings?.length) setError(warnings.map((warning) => warning.message).join("；"));
      const detail = toEdgeApp(item.yaml);
      setSelected({
        ...detail,
        status: edgeAppSummaryStatusText(item.status),
        statusColor: item.status === "running" ? "success" : item.status === "unknown" ? "default" : "warning",
        node: item.targetNodeGroups.length > 0 ? item.targetNodeGroups.join(", ") : detail.node,
        pods: `${item.pods.filter((pod) => pod.status === "Running").length}/${item.pods.length}`,
        availableReplicas: item.workloads.reduce((sum, workload) => sum + Number(workload.availableReplicas || 0), 0) || detail.availableReplicas,
        desiredReplicas: item.workloads.reduce((sum, workload) => sum + Number(workload.replicas || 0), 0) || detail.desiredReplicas,
        raw: item.yaml,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载边缘应用详情失败");
    }
  };

  const openEdit = async (a: EdgeApp) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = toEdgeApp(await getEdgeApplication(a.namespace, a.name));
      setEditItem(detail);
      setEditForm({
        image: detail.images[0] || "",
        cpuLimit: detail.cpuLimit || "100m",
        memoryLimit: detail.memoryLimit || "128Mi",
        replicas: detail.desiredReplicas || 1,
      });
      setEditOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载边缘应用详情失败");
    } finally {
      setIsLoading(false);
    }
  };

  const openDelete = (a: EdgeApp) => {
    setDeleteItem(a);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;
    if (!deleteItem.name || deleteItem.name === "-") {
      setError("边缘应用名称无效，请刷新列表后重试");
      setDeleteOpen(false);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      await deleteEdgeApplicationResource(deleteItem.namespace, deleteItem.name);
      setDeleteOpen(false);
      setDeleteItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除边缘应用失败");
    } finally {
      setIsLoading(false);
    }
  };

  const togglePause = async (a: EdgeApp) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = await getEdgeApplication(a.namespace, a.name);
      await updateEdgeApplicationResource(a.namespace, {
        ...detail,
        spec: {
          ...(detail.spec || {}),
          paused: !Boolean(detail.spec?.paused),
        },
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新边缘应用暂停状态失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestart = async (a: EdgeApp) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = await getEdgeApplication(a.namespace, a.name);
      await updateEdgeApplicationResource(
        a.namespace,
        updateWorkloadTemplateMetadata(detail, { "blueedge.io/restartedAt": new Date().toISOString() }),
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重启边缘应用失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (createMode === "yaml") {
      setIsLoading(true);
      setError("");
      try {
        if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
        await createEdgeApplicationResource(assignEdgeApplicationToEdgeUnit(validateEdgeApplicationResource(parseSimpleYaml(yamlText)), selectedEdgeUnitName));
        setCreateOpen(false);
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建边缘应用失败");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const normalizedForm = {
      ...form,
      name: form.name.trim(),
      containers: form.containers.map((container) => ({ ...container, name: container.name.trim(), image: container.image.trim() })),
      initContainers: form.initContainers.map((container) => ({ ...container, name: container.name.trim(), image: container.image.trim() })),
    };
    if (!normalizedForm.name || !isValidK8sName(normalizedForm.name)) {
      setError("边缘应用名称只能包含小写字母、数字和中划线，且首尾必须是字母或数字");
      return;
    }
    if (!normalizedForm.containers.length || normalizedForm.containers.some((container) => !container.name || !container.image)) {
      setError("至少需要一个工作容器，并填写每个容器的名称和镜像");
      return;
    }
    if (normalizedForm.initContainers.some((container) => !container.name || !container.image)) {
      setError("请填写每个初始化容器的名称和镜像");
      return;
    }
    if (!normalizedForm.targetNodeGroup.trim()) {
      setError("请选择或填写目标节点组");
      return;
    }
    const duplicateContainerNames = [...normalizedForm.containers, ...normalizedForm.initContainers].map((container) => container.name).filter((name, index, names) => names.indexOf(name) !== index);
    if (duplicateContainerNames.length) {
      setError(`容器名称不能重复：${duplicateContainerNames.join("、")}`);
      return;
    }
    const invalidContainerName = [...normalizedForm.containers, ...normalizedForm.initContainers].find((container) => !isValidK8sName(container.name));
    if (invalidContainerName) {
      setError(`容器名称不符合 Kubernetes 命名规则：${invalidContainerName.name}`);
      return;
    }
    const volumeNames = normalizedForm.volumes.map((volume) => volume.name.trim());
    if (volumeNames.some((name) => !name || !isValidK8sName(name))) {
      setError("请填写合法且非空的数据卷名称");
      return;
    }
    const duplicateVolumeNames = volumeNames.filter((name, index) => volumeNames.indexOf(name) !== index);
    if (duplicateVolumeNames.length) {
      setError(`数据卷名称不能重复：${duplicateVolumeNames.join("、")}`);
      return;
    }
    const invalidVolume = normalizedForm.volumes.find((volume) => {
      if (volume.type === "persistentVolumeClaim" || volume.type === "configMap" || volume.type === "secret") return !volume.sourceName.trim();
      if (volume.type === "hostPath") return !volume.hostPath.trim();
      return false;
    });
    if (invalidVolume) {
      setError(`数据卷 ${invalidVolume.name || "未命名"} 缺少来源配置`);
      return;
    }
    const allContainers = [...normalizedForm.containers, ...normalizedForm.initContainers];
    const invalidPort = allContainers.flatMap((container) => container.ports.map((port) => ({ container, port }))).find(({ port }) => {
      const containerPort = Number(port.containerPort);
      const hostPort = port.hostPort.trim() ? Number(port.hostPort) : undefined;
      return !Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535 || (hostPort !== undefined && (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535));
    });
    if (invalidPort) {
      setError(`容器 ${invalidPort.container.name} 的端口必须是 1 到 65535 之间的整数`);
      return;
    }
    const invalidSecurity = allContainers.find((container) => [container.runAsUser, container.runAsGroup].some((value) => value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 0)));
    if (invalidSecurity) {
      setError(`容器 ${invalidSecurity.name} 的 UID/GID 必须是非负整数`);
      return;
    }
    const invalidGpu = allContainers.find((container) => container.gpuCount.trim() && (!Number.isInteger(Number(container.gpuCount)) || Number(container.gpuCount) < 1 || !container.gpuResourceName.trim()));
    if (invalidGpu) {
      setError(`容器 ${invalidGpu.name} 的 GPU 数量必须是正整数，并填写扩展资源名称`);
      return;
    }
    const invalidProbe = allContainers.flatMap((container) => ([container.livenessProbe, container.readinessProbe, container.startupProbe].map((probe) => ({ container, probe })))).find(({ probe }) => probe.enabled && (probe.type === "exec" ? !probe.command.some((item) => item.trim()) : (!probe.port.trim() || (probe.type === "httpGet" && !probe.path.trim()))));
    if (invalidProbe) {
      setError(`容器 ${invalidProbe.container.name} 的健康检查配置不完整`);
      return;
    }
    const invalidLifecycle = allContainers.flatMap((container) => ([container.postStart, container.preStop].map((action) => ({ container, action })))).find(({ action }) => action.enabled && (action.type === "exec" ? !action.command.some((item) => item.trim()) : !action.port.trim()));
    if (invalidLifecycle) {
      setError(`容器 ${invalidLifecycle.container.name} 的生命周期动作配置不完整`);
      return;
    }
    const invalidMount = allContainers.flatMap((container) => container.volumeMounts.map((mount) => ({ container, mount }))).find(({ mount }) => !volumeNames.includes(mount.name.trim()) || !mount.mountPath.trim());
    if (invalidMount) {
      setError(`容器 ${invalidMount.container.name} 的挂载必须引用已定义的数据卷，并填写 mountPath`);
      return;
    }
    const invalidEnv = allContainers.flatMap((container) => container.env.map((env) => ({ container, env }))).find(({ env }) => env.source !== "value" && (!env.resourceName.trim() || !env.key.trim()));
    if (invalidEnv) {
      setError(`容器 ${invalidEnv.container.name} 的环境变量 ${invalidEnv.env.name || "未命名"} 缺少资源名称或键`);
      return;
    }
    const invalidEnvFrom = allContainers.flatMap((container) => container.envFrom.map((envFrom) => ({ container, envFrom }))).find(({ envFrom }) => !envFrom.name.trim());
    if (invalidEnvFrom) {
      setError(`容器 ${invalidEnvFrom.container.name} 的整体环境变量来源不能为空`);
      return;
    }
    const invalidNodeSelector = normalizedForm.nodeSelectorText.split("\n").map((line) => line.trim()).filter(Boolean).find((line) => {
      const separator = line.indexOf("=");
      return separator <= 0 || !line.slice(separator + 1).trim();
    });
    if (invalidNodeSelector) {
      setError(`节点选择器必须使用 key=value 格式：${invalidNodeSelector}`);
      return;
    }
    const invalidPair = [
      normalizedForm.workloadLabelsText,
      normalizedForm.podLabelsText,
      normalizedForm.workloadAnnotationsText,
      normalizedForm.podAnnotationsText,
    ].flatMap((text) => text.split("\n")).map((line) => line.trim()).filter(Boolean).find((line) => {
      const separator = line.indexOf("=");
      return separator <= 0 || !line.slice(separator + 1).trim();
    });
    if (invalidPair) {
      setError(`标签和注解必须使用 key=value 格式：${invalidPair}`);
      return;
    }
    if (normalizedForm.networkMode === "portMapping" && !normalizedForm.containers.some((container) => container.ports.some((port) => port.hostPort.trim()))) {
      setError("选择端口映射时，至少需要为一个工作容器配置 hostPort");
      return;
    }
    if (normalizedForm.type === "Deployment") {
      const durationFields = [normalizedForm.minReadySeconds, normalizedForm.progressDeadlineSeconds, normalizedForm.revisionHistoryLimit];
      if (durationFields.some((value) => value.trim() && (!Number.isInteger(Number(value)) || Number(value) < 0))) {
        setError("Pod 可用最短时间、升级最大持续时间和最大保留版本数必须是非负整数");
        return;
      }
      if (normalizedForm.strategyType === "RollingUpdate" && [normalizedForm.maxUnavailable, normalizedForm.maxSurge].some((value) => !/^(\d+|\d+%)$/.test(value.trim()))) {
        setError("最大无效 Pod 数和最大浪涌必须填写整数或百分比，例如 1、25%");
        return;
      }
    }
    const gracePeriod = Number(normalizedForm.terminationGracePeriodSeconds);
    if (normalizedForm.terminationGracePeriodSeconds.trim() && (!Number.isInteger(gracePeriod) || gracePeriod < 0)) {
      setError("终止宽限时间必须是非负整数");
      return;
    }
    const invalidPullSecret = normalizedForm.imagePullSecrets.split(",").map((name) => name.trim()).filter(Boolean).find((name) => !isValidK8sName(name));
    if (invalidPullSecret) {
      setError(`镜像仓库 Secret 名称不合法：${invalidPullSecret}`);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      if (!selectedEdgeUnitName) throw new Error("请先选择边缘单元");
      await createEdgeApplicationResource(assignEdgeApplicationToEdgeUnit(buildEdgeApplicationResource(normalizedForm), selectedEdgeUnitName));
      setCreateOpen(false);
      setForm({
        name: "",
        namespace: "default",
        type: "Deployment",
        replicas: 1,
        targetNodeGroup: defaultTargetNodeGroupName,
        imagePullSecrets: "",
        containers: [emptyContainer("edge-app", "nginx:latest")],
        initContainers: [],
        volumes: [],
        hostNetwork: false,
        networkMode: "none",
        hostPID: false,
        hostIPC: false,
        shareProcessNamespace: false,
        dnsPolicy: "ClusterFirst",
        serviceAccountName: "",
        runtimeClassName: "",
        nodeSelectorText: "",
        terminationGracePeriodSeconds: "30",
        alias: "",
        description: "",
        workloadLabelsText: "",
        podLabelsText: "",
        workloadAnnotationsText: "",
        podAnnotationsText: "",
        strategyType: "RollingUpdate",
        maxUnavailable: "25%",
        maxSurge: "25%",
        revisionHistoryLimit: "10",
        minReadySeconds: "0",
        progressDeadlineSeconds: "600",
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建边缘应用失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editItem) return;
    if (!editForm.image.trim()) {
      setEditImageError("请输入容器镜像");
      window.requestAnimationFrame(() => {
        document.getElementById("edge-app-edit-image")?.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById("edge-app-edit-image")?.focus({ preventScroll: true });
      });
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      let updated = updateFirstContainer(editItem.raw, {
        image: editForm.image,
        resources: {
          limits: {
            cpu: editForm.cpuLimit,
            memory: editForm.memoryLimit,
          },
        },
      });
      const spec = { ...(updated.spec || {}) } as Record<string, any>;
      if (editItem.type === "Deployment") {
        const manifests = Array.isArray(spec.workloadTemplate?.manifests) ? [...spec.workloadTemplate.manifests] : [];
        if (manifests[0]?.spec) {
          manifests[0] = {
            ...manifests[0],
            spec: {
              ...manifests[0].spec,
              replicas: editForm.replicas,
            },
          };
          spec.workloadTemplate = {
            ...spec.workloadTemplate,
            manifests,
          };
        } else if (spec.workloadTemplate?.spec) {
          spec.workloadTemplate = {
            ...spec.workloadTemplate,
            spec: {
              ...spec.workloadTemplate.spec,
              replicas: editForm.replicas,
            },
          };
        } else {
          spec.replicas = editForm.replicas;
        }
        updated = { ...updated, spec };
      }
      await updateEdgeApplicationResource(editItem.namespace, updated);
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新边缘应用失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="blueedge-page space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">边缘应用</h1>
          <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">面向节点组交付和治理边缘侧应用实例。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="blueedge-muted-button h-9 px-3 text-sm"
            onClick={() => void loadData(true)}
            disabled={isLoading || isRefreshing}
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", (isLoading || isRefreshing) && "animate-spin")} />
            刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="blueedge-primary-button h-9 px-3 text-sm">
                <Plus className="w-3.5 h-3.5 mr-1" />
                创建边缘应用
              </Button>
            </DialogTrigger>
            <DialogContent className="h-screen w-screen max-w-none gap-0 overflow-hidden rounded-none border-0 p-0 [&>button]:hidden">
              <EdgeAppCreateWizard
                form={form}
                onFormChange={setForm}
                namespaces={namespaces}
                nodeGroups={nodeGroupOptions}
                mode={createMode}
                onModeChange={setCreateMode}
                yamlText={yamlText}
                onYamlChange={setYamlText}
                generatedYaml={generatedFormYaml}
                error={error}
                submitting={isLoading}
                onCancel={() => setCreateOpen(false)}
                onSubmit={handleCreate}
              />
              <div className="hidden">
              <DialogHeader className="px-6 pt-6 pb-3">
                <DialogTitle className="text-base">创建边缘应用</DialogTitle>
              </DialogHeader>
              <Tabs value={createMode} onValueChange={setCreateMode} className="min-h-0 overflow-hidden px-6">
                <TabsList className="bg-[var(--color-bg-soft)] h-9">
                  <TabsTrigger value="form" className="text-xs h-7">表单</TabsTrigger>
                  <TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger>
                  <TabsTrigger value="preview" className="text-xs h-7">表单 YAML 预览</TabsTrigger>
                </TabsList>
                <TabsContent value="form" className="space-y-4 mt-4 max-h-[62vh] overflow-y-auto pr-1 pb-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[var(--color-text-secondary)]">名称</Label>
                    <Input placeholder="如 edge-app" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9 text-sm" />
                    {createNameError && <p className="text-xs text-[var(--color-danger)]">{createNameError}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[var(--color-text-secondary)]">类型</Label>
                    <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Deployment" className="text-sm">Deployment</SelectItem>
                        <SelectItem value="Job" className="text-sm">Job</SelectItem>
                        <SelectItem value="Pod" className="text-sm">Pod</SelectItem>
                        <SelectItem value="DaemonSet" className="text-sm">DaemonSet</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label>
                    <Select value={form.namespace} onValueChange={(v) => setForm({ ...form, namespace: v })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {namespaces.filter(n=>n.value!=="all").map((ns) => (
                          <SelectItem key={ns.value} value={ns.value} className="text-sm">{ns.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.type === "Deployment" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--color-text-secondary)]">副本数</Label>
                      <Input type="number" min={1} value={form.replicas} onChange={(e) => setForm({ ...form, replicas: Number(e.target.value) })} className="h-9 text-sm" />
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--color-text-secondary)]">目标节点组</Label>
                      <Select value={form.targetNodeGroup} onValueChange={(v) => setForm({ ...form, targetNodeGroup: v })}>
                        <SelectTrigger className="h-9 bg-white text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {nodeGroupOptions.map((name) => (
                            <SelectItem key={name} value={name} className="text-sm">{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--color-text-secondary)]">节点组名称</Label>
                      <Input
                        value={form.targetNodeGroup}
                        onChange={(e) => setForm({ ...form, targetNodeGroup: e.target.value })}
                        className="h-9 bg-white text-sm"
                        placeholder="如 edge-group"
                      />
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)]">边缘应用会写入 workloadScope.targetNodeGroups，实际落到该节点组匹配的边缘节点。</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3 space-y-3"><div className="text-sm font-medium">Pod 运行设置</div><div className="grid grid-cols-2 gap-3"><Select value={form.dnsPolicy} onValueChange={(dnsPolicy) => setForm({ ...form, dnsPolicy })}><SelectTrigger className="h-9 bg-white text-sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ClusterFirst">ClusterFirst</SelectItem><SelectItem value="ClusterFirstWithHostNet">ClusterFirstWithHostNet</SelectItem><SelectItem value="Default">Default</SelectItem><SelectItem value="None">None</SelectItem></SelectContent></Select><Input className="h-9 bg-white text-sm" value={form.terminationGracePeriodSeconds} placeholder="终止宽限秒数" onChange={(e)=>setForm({...form,terminationGracePeriodSeconds:e.target.value})}/><Input className="h-9 bg-white text-sm" value={form.serviceAccountName} placeholder="ServiceAccount（可选）" onChange={(e)=>setForm({...form,serviceAccountName:e.target.value})}/><Input className="h-9 bg-white text-sm" value={form.runtimeClassName} placeholder="RuntimeClass（可选，如 nvidia）" onChange={(e)=>setForm({...form,runtimeClassName:e.target.value})}/></div><div className="flex flex-wrap gap-4">{([['hostNetwork','使用主机网络'],['hostPID','共享主机 PID'],['hostIPC','共享主机 IPC'],['shareProcessNamespace','容器间共享进程命名空间']] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form[key]} onChange={(e)=>setForm({...form,[key]:e.target.checked,...(key === 'hostNetwork' && e.target.checked && form.dnsPolicy === 'ClusterFirst' ? {dnsPolicy:'ClusterFirstWithHostNet'} : {})})}/>{label}</label>)}</div><div><Label className="text-xs text-[var(--color-text-secondary)]">节点选择器</Label><Textarea className="mt-1 min-h-20 bg-white font-mono text-xs" value={form.nodeSelectorText} onChange={(e)=>setForm({...form,nodeSelectorText:e.target.value})} placeholder={'每行 key=value，例如：\nnvidia.com/gpu.product=A100'}/></div></div>
                <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">镜像仓库密钥</Label><Input value={form.imagePullSecrets} onChange={(e) => setForm({ ...form, imagePullSecrets: e.target.value })} className="h-9 text-sm" placeholder="多个 Secret 用逗号分隔" /></div>
                <div className="flex items-center justify-between"><div><h3 className="text-sm font-medium">工作容器</h3><p className="text-xs text-[var(--color-text-tertiary)]">支持添加多个容器，配置能力与初始化容器一致。</p></div><Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, containers: [...form.containers, emptyContainer(`container-${form.containers.length + 1}`, "")] })}><Plus className="mr-1 h-3.5 w-3.5"/>添加工作容器</Button></div>
                {form.containers.map((container, index) => <ContainerEditor key={container.id} title={`工作容器 ${index + 1}`} value={container} onChange={(next) => setForm({ ...form, containers: form.containers.map((item) => item.id === container.id ? next : item) })} onRemove={form.containers.length > 1 ? () => setForm({ ...form, containers: form.containers.filter((item) => item.id !== container.id) }) : undefined}/>) }
                <div className="flex items-center justify-between border-t pt-4"><div><h3 className="text-sm font-medium">初始化容器</h3><p className="text-xs text-[var(--color-text-tertiary)]">按顺序运行，可添加任意多个，拥有与工作容器相同的配置能力。</p></div><Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, initContainers: [...form.initContainers, emptyContainer(`init-${form.initContainers.length + 1}`, "busybox:latest")] })}><Plus className="mr-1 h-3.5 w-3.5"/>添加初始化容器</Button></div>
                {form.initContainers.map((container, index) => <ContainerEditor key={container.id} title={`初始化容器 ${index + 1}`} isInit value={container} onChange={(next) => setForm({ ...form, initContainers: form.initContainers.map((item) => item.id === container.id ? next : item) })} onRemove={() => setForm({ ...form, initContainers: form.initContainers.filter((item) => item.id !== container.id) })}/>) }
                <VolumeEditor values={form.volumes} onChange={(volumes) => setForm({ ...form, volumes })}/>
                </TabsContent>
                <TabsContent value="yaml" className="mt-4 max-h-[62vh] overflow-y-auto pb-2">
                  <Textarea
                    value={yamlText}
                    onChange={(e) => setYamlText(e.target.value)}
                    className="min-h-[520px] text-xs font-mono leading-relaxed"
                    spellCheck={false}
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-4 max-h-[62vh] overflow-y-auto pb-2"><Textarea value={generatedFormYaml} readOnly className="min-h-[520px] bg-[var(--color-bg-soft)] text-xs font-mono leading-relaxed" spellCheck={false}/></TabsContent>
              </Tabs>
              <DialogFooter className="border-t border-[var(--color-border-strong)] px-6 py-4">
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button size="sm" onClick={handleCreate}>创建</Button>
              </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-base">编辑边缘应用</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-4">
                  <InfoCard label="名称" value={editItem?.name || "-"} />
                  <InfoCard label="类型" value={editItem?.type || "-"} />
                </div>
                {editItem?.type === "Deployment" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-[var(--color-text-secondary)]">副本数</Label>
                    <Input type="number" min={1} value={editForm.replicas} onChange={(e) => setEditForm({ ...editForm, replicas: Number(e.target.value) })} className="h-9 text-sm" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--color-text-secondary)]">镜像</Label>
                  <Input id="edge-app-edit-image" value={editForm.image} onChange={(e) => { setEditForm({ ...editForm, image: e.target.value }); setEditImageError(""); }} aria-invalid={Boolean(editImageError)} className="h-9 text-sm" />
                  {editImageError && <p className="mt-1 text-xs text-[var(--color-danger)]">{editImageError}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">CPU 限制</Label><Input value={editForm.cpuLimit} onChange={(e) => setEditForm({ ...editForm, cpuLimit: e.target.value })} className="h-9 text-sm" /></div>
                  <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">内存限制</Label><Input value={editForm.memoryLimit} onChange={(e) => setEditForm({ ...editForm, memoryLimit: e.target.value })} className="h-9 text-sm" /></div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button>
                <Button size="sm" onClick={handleEdit}>保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <Input
              placeholder="请输入名称搜索"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="h-9 bg-white pl-9 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--color-text-tertiary)]" />
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="h-9 w-[140px] text-sm">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-sm">全部类型</SelectItem>
                <SelectItem value="Deployment" className="text-sm">Deployment</SelectItem>
                <SelectItem value="Job" className="text-sm">Job</SelectItem>
                <SelectItem value="Pod" className="text-sm">Pod</SelectItem>
                <SelectItem value="DaemonSet" className="text-sm">DaemonSet</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span>
        </div>
      </div>

      {error && <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">{error}</div>}

      {/* Table */}
      <div className="table-card">
        <Table>
          <TableHeader>
            <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">名称</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">类型</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">状态</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">边缘节点</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">CPU / 内存</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">镜像</TableHead>
              <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">重启</TableHead>
              <TableHead className="w-[180px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">正在加载边缘应用数据...</span></div></TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9}><div className="blueedge-empty-state"><span className="blueedge-empty-state-icon" aria-hidden="true" /><span className="text-sm">暂无边缘应用数据</span></div></TableCell>
              </TableRow>
            ) : (
              paginated.map((row) => {
                const TypeIcon = typeIcons[row.type] || Server;
                return (
                  <TableRow key={row.name} className="h-[69px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
                    <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.namespace}</TableCell>
                    <TableCell className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-brand)] hover:underline" onClick={() => openDetail(row)}>
                      {row.name}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge className={cn("text-xs font-normal border-0", typeColors[row.type] || "bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)]")}>
                        <TypeIcon className="w-3 h-3 mr-1" />
                        {row.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={row.status} color={row.statusColor} />
                    </TableCell>
                    <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">
                      <Badge variant="outline" className="text-xs font-normal border-[var(--color-border-strong)] text-[var(--color-text-secondary)]">
                        {row.node}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span>{row.cpuLimit !== "-" ? row.cpuLimit : `${row.cpu} m`}</span>
                        <span className="text-[var(--color-text-tertiary)]">{row.memoryLimit !== "-" ? row.memoryLimit : row.memory}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3 max-w-[180px] truncate" title={row.images[0]}>
                      {row.images[0].split("/").pop() || row.images[0]}
                    </TableCell>
                    <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.restartCount}</TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="action-group">
                        <button type="button" className="action-button" title="查看详情" onClick={() => openDetail(row)}>
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="action-button" title="编辑" onClick={() => openEdit(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="action-button" title="重启" onClick={() => handleRestart(row)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" className="action-button is-danger" title="删除" onClick={() => openDelete(row)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <ListPagination total={filtered.length} page={currentPage} pageSize={pageSize} onPageChange={setCurrentPage} onPageSizeChange={(size) => { setPageSize(size); setCurrentPage(1); }} />
      </div>

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={selected?.status || ""} color={selected?.statusColor || "default"} />
              <Badge className={cn("text-xs font-normal border-0", typeColors[selected?.type || ""] || "")}>
                {selected?.type}
              </Badge>
              <Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge>
            </div>
          </SheetHeader>
          {selected && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="bg-[var(--color-bg-soft)] h-9">
                <TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger>
                <TabsTrigger value="resource" className="text-xs h-7">资源</TabsTrigger>
                <TabsTrigger value="logs" className="text-xs h-7">日志</TabsTrigger>
                <TabsTrigger value="yaml" className="text-xs h-7">完整 YAML</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="mt-3 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <InfoCard label="名称" value={selected.name} />
                  <InfoCard label="类型" value={selected.type} />
                  <InfoCard label="命名空间" value={selected.namespace} />
                  <InfoCard label="边缘节点" value={selected.node} />
                  {selected.desiredReplicas !== undefined && (
                    <InfoCard label="副本数" value={`${selected.availableReplicas || 0} / ${selected.desiredReplicas}`} />
                  )}
                  {selected.completion && (
                    <InfoCard label="完成度" value={selected.completion} />
                  )}
                  {selected.desired !== undefined && (
                    <InfoCard label="期望/当前/就绪" value={`${selected.desired}/${selected.current}/${selected.ready}`} />
                  )}
                  <InfoCard label="重启次数" value={String(selected.restartCount)} />
                  <InfoCard label="运行时长" value={selected.age} />
                  {selected.ip && <InfoCard label="Pod IP" value={selected.ip} />}
                </div>
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase">镜像</h4>
                  <div className="bg-[var(--color-bg-soft)] rounded-md px-3 py-2 text-sm text-[var(--color-text-secondary)] font-mono">{selected.images[0]}</div>
                </div>
                {selected.ports.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase">端口</h4>
                    <div className="flex flex-wrap gap-2">
                      {selected.ports.map((p, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal">{p}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase">标签</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selected.labels).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-xs font-normal bg-[var(--color-brand-light)] text-[var(--color-brand)]">{k}: {v}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => handleRestart(selected)}>
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    重启
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => togglePause(selected)}>
                    {selected.status === "已暂停" ? <Play className="w-3.5 h-3.5 mr-1" /> : <Pause className="w-3.5 h-3.5 mr-1" />}
                    {selected.status === "已暂停" ? "恢复" : "暂停"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs text-[var(--color-text-secondary)]" onClick={() => { setDetailOpen(false); openDelete(selected); }}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    <span>删除</span>
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="resource" className="mt-3 space-y-3">
                <InfoCard label="CPU 使用" value={`${selected.cpu} m`} />
                <InfoCard label="内存使用" value={selected.memory} />
                <InfoCard label="CPU 限制" value={selected.cpuLimit} />
                <InfoCard label="内存限制" value={selected.memoryLimit} />
                <div className="bg-[var(--color-bg-soft)] rounded-md p-3">
                  <h4 className="text-xs text-[var(--color-text-tertiary)] mb-2">资源使用趋势</h4>
                  <div className="h-2 bg-[var(--color-border-strong)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--color-brand)] rounded-full" style={{ width: `${Math.min(100, Number(selected.cpu) * 2)}%` }} />
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">CPU 使用率: {selected.cpu} m / {selected.cpuLimit}</p>
                </div>
                <div className="bg-[var(--color-bg-soft)] rounded-md p-3">
                  <div className="h-2 bg-[var(--color-border-strong)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--color-success)] rounded-full" style={{ width: `${Math.min(100, Number(selected.memory.replace(/[^0-9]/g, "")) / 2)}%` }} />
                  </div>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-1">内存使用率: {selected.memory} / {selected.memoryLimit}</p>
                </div>
              </TabsContent>
              <TabsContent value="logs" className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="mb-2 h-8 text-xs"
                    onClick={async () => {
                      setDetailLogs("正在加载日志...");
                      setDetailLogWarning("");
                      try {
                        const res = await getResourceLogs("edgeapplication", selected.namespace, selected.name, { tailLines: 200 });
                        const first = res.item.pods.find((pod) => pod.available) || res.item.pods[0];
                        setDetailLogs(first?.content || "未找到关联 Pod 日志");
                        setDetailLogWarning((res.warnings || []).map((warning) => warning.message).join("；"));
                      } catch (err) {
                        setDetailLogs(err instanceof Error ? err.message : "加载日志失败");
                      }
                    }}
                  >
                    加载日志
                  </Button>
                  {detailLogWarning && <div className="mb-2 rounded-md border border-[#F7BA1E]/30 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{detailLogWarning}</div>}
                  <pre className="blueedge-code-block p-4 h-[400px] overflow-y-auto whitespace-pre-wrap leading-relaxed text-[var(--color-text-tertiary)]">{detailLogs}</pre>
              </TabsContent>
              <TabsContent value="yaml" className="mt-3">
                <div className="relative">
                  <pre className="max-h-[640px] overflow-auto whitespace-pre blueedge-code-block p-4 leading-relaxed">{exportableEdgeApplicationYaml(selected)}</pre>
                  <Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(exportableEdgeApplicationYaml(selected))}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Alert */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">确认删除边缘应用？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              即将删除应用 <span className="font-medium text-[var(--color-text-primary)]">{deleteItem?.name}</span>（类型：{deleteItem?.type}，命名空间：{deleteItem?.namespace}），此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel>
            <AlertDialogAction className="h-8 text-sm" onClick={confirmDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="blueedge-info-card">
      <p className="blueedge-info-card-label">{label}</p>
      <p className="blueedge-info-card-value">{value}</p>
    </div>
  );
}
