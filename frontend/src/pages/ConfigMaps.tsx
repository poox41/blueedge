import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useNamespace } from "@/contexts/NamespaceContext";
import yaml from "js-yaml";
import { ArrowLeft, Copy, Database, Download, Edit3, ExternalLink, FileCode2, Info, Maximize2, MessageSquareText, Minimize2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, ShieldCheck, Tags, Trash2, Upload, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  createConfigMapResource,
  createSecretResource,
  deleteConfigMapResource,
  deleteSecretResource,
  getConfigMap,
  getSecret,
  listConfigMaps,
  listNamespaces,
  listSecrets,
  updateConfigMapResource,
  updateSecretResource,
} from "@/api/services/resources";
import type { KubeResource } from "@/types/kubeedge";

type ConfigType = "配置项" | "密钥";

type KvPair = {
  id: string;
  key: string;
  value: string;
};

type ConfigItem = {
  id: string;
  name: string;
  alias: string;
  type: ConfigType;
  namespace: string;
  labels: Record<string, string>;
  createTime: string;
  dataCount: number;
  mountTargets: string[];
  description?: string;
  data?: Record<string, string>;
  raw?: KubeResource;
};

type ConfigForm = {
  name: string;
  alias: string;
  namespace: string;
  description: string;
  dataPairs: KvPair[];
  labels: KvPair[];
  annotations: KvPair[];
};

const namePattern = /^[a-z0-9]([a-z0-9-.]{0,61}[a-z0-9])?$/;

const emptyForm = (): ConfigForm => ({
  name: "",
  alias: "",
  namespace: "default",
  description: "",
  dataPairs: [],
  labels: [],
  annotations: [],
});

const formatLabels = (labels: Record<string, string>) => {
  const text = Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(", ");
  return text || "-";
};

const pairsToRecord = (pairs: KvPair[]) =>
  Object.fromEntries(pairs.filter((pair) => pair.key.trim()).map((pair) => [pair.key.trim(), pair.value]));

const recordToPairs = (record: Record<string, string> | undefined, prefix: string): KvPair[] =>
  Object.entries(record || {}).map(([key, value], index) => ({ id: `${prefix}-${index}-${key}`, key, value }));

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const stringifyRecord = (record: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]));

const getMetadata = (resource: KubeResource) => asRecord(resource.metadata);

const getCreatedAt = (resource: KubeResource) => String(resource.metadata?.creationTimestamp || resource.creationTimestamp || "-");

const getAnnotations = (resource: KubeResource): Record<string, string> => stringifyRecord(asRecord(resource.metadata?.annotations));

const getEditableAnnotations = (resource: KubeResource): Record<string, string> => {
  const annotations = getAnnotations(resource);
  delete annotations["blueedge.io/alias"];
  delete annotations.alias;
  delete annotations["blueedge.io/description"];
  delete annotations.description;
  return annotations;
};

const getLabels = (resource: KubeResource): Record<string, string> => stringifyRecord(asRecord(resource.metadata?.labels || resource.labels));

const maskSecretData = (resource: KubeResource): Record<string, string> => {
  const keys = new Set([
    ...Object.keys(asRecord(resource.data)),
    ...Object.keys(asRecord(resource.stringData)),
  ]);
  return Object.fromEntries(Array.from(keys).map((key) => [key, "******"]));
};

const toConfigItem = (resource: KubeResource, type: ConfigType): ConfigItem => {
  const metadata = getMetadata(resource);
  const annotations = getAnnotations(resource);
  const data = type === "密钥"
    ? maskSecretData(resource)
    : stringifyRecord(asRecord(resource.data));
  const name = String(metadata.name || resource.name || "-");
  const namespace = String(metadata.namespace || resource.namespace || "default");
  return {
    id: `${type}/${namespace}/${name}`,
    name,
    alias: annotations["blueedge.io/alias"] || annotations.alias || "",
    type,
    namespace,
    labels: getLabels(resource),
    createTime: getCreatedAt(resource),
    dataCount: Object.keys(data).length,
    mountTargets: [],
    description: annotations["blueedge.io/description"] || annotations.description || "",
    data,
    raw: resource,
  };
};

const buildConfigYaml = (item: ConfigItem) => {
  if (item.type === "密钥") {
    return yaml.dump({
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: item.name,
        namespace: item.namespace,
        ...(Object.keys(item.labels).length > 0 ? { labels: item.labels } : {}),
        ...(Object.keys(getAnnotations(item.raw || {})).length > 0 ? { annotations: getAnnotations(item.raw || {}) } : {}),
      },
      type: String(item.raw?.type || "Opaque"),
      stringData: Object.fromEntries(Object.keys(item.data || {}).map((key) => [key, ""])),
    }, { lineWidth: -1, noRefs: true });
  }

  const resource = {
    ...(item.raw || {}),
    apiVersion: item.raw?.apiVersion || "v1",
    kind: "ConfigMap",
    metadata: {
      ...(item.raw?.metadata || {}),
      name: item.name,
      namespace: item.namespace,
      labels: item.labels,
      annotations: getAnnotations(item.raw || {}),
    },
    data: item.data || {},
  } as KubeResource;
  const metadata = resource.metadata as KubeResource["metadata"] & { managedFields?: unknown };
  if (metadata) delete metadata.managedFields;
  return yaml.dump(resource, { lineWidth: -1, noRefs: true });
};

const buildConfigResource = (form: ConfigForm, type: ConfigType): KubeResource => {
  const labels = pairsToRecord(form.labels);
  const annotations = {
    ...(form.alias.trim() ? { "blueedge.io/alias": form.alias.trim() } : {}),
    ...(form.description.trim() ? { "blueedge.io/description": form.description.trim() } : {}),
    ...pairsToRecord(form.annotations),
  };
  const data = pairsToRecord(form.dataPairs);

  return {
    apiVersion: "v1",
    kind: type === "密钥" ? "Secret" : "ConfigMap",
    metadata: {
      name: form.name.trim(),
      namespace: form.namespace || "default",
      ...(Object.keys(labels).length ? { labels } : {}),
      ...(Object.keys(annotations).length ? { annotations } : {}),
    },
    ...(type === "密钥"
      ? { type: "Opaque", stringData: data }
      : { data }),
  };
};

const buildUpdatedConfigResource = (item: ConfigItem, form: ConfigForm): KubeResource => {
  const labels = pairsToRecord(form.labels);
  const annotations = {
    ...(form.alias.trim() ? { "blueedge.io/alias": form.alias.trim() } : {}),
    ...(form.description.trim() ? { "blueedge.io/description": form.description.trim() } : {}),
    ...pairsToRecord(form.annotations),
  };
  const resource: KubeResource = {
    ...(item.raw || {}),
    apiVersion: item.raw?.apiVersion || "v1",
    kind: item.type === "密钥" ? "Secret" : "ConfigMap",
    metadata: {
      ...(item.raw?.metadata || {}),
      name: item.name,
      namespace: item.namespace,
      labels,
      annotations,
    },
  };
  if (item.type === "密钥") {
    resource.stringData = pairsToRecord(form.dataPairs);
    delete resource.data;
  } else {
    resource.data = pairsToRecord(form.dataPairs);
  }
  const metadata = resource.metadata as KubeResource["metadata"] & { managedFields?: unknown };
  if (metadata) delete metadata.managedFields;
  return resource;
};

const parseResourceYaml = (source: string, fallbackType: ConfigType): { resource: KubeResource; type: ConfigType } => {
  const parsed = yaml.load(source) as KubeResource;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAML 内容必须是 Kubernetes ConfigMap 或 Secret 对象");
  }
  const kind = String(parsed.kind || "");
  const normalizedKind = kind.toLowerCase();
  const type: ConfigType = normalizedKind === "secret"
    ? "密钥"
    : normalizedKind === "configmap"
      ? "配置项"
      : fallbackType;
  if (kind && normalizedKind !== "configmap" && normalizedKind !== "secret") {
    throw new Error("当前只支持 ConfigMap 或 Secret");
  }
  return {
    type,
    resource: {
      ...parsed,
      kind: type === "密钥" ? "Secret" : "ConfigMap",
      metadata: {
        ...(parsed.metadata || {}),
        namespace: parsed.metadata?.namespace || "default",
      },
    },
  };
};

const downloadTextFile = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const highlightYamlValue = (value: string): string => {
  const leading = value.match(/^\s*/)?.[0] || "";
  const raw = value.slice(leading.length);
  if (!raw) return escapeHtml(value);
  const color = /^(true|false|null|~)$/i.test(raw)
    ? "#569CD6"
    : /^-?\d+(\.\d+)?$/.test(raw)
      ? "#B5CEA8"
      : "#CE9178";
  return `${escapeHtml(leading)}<span style="color:${color}">${escapeHtml(raw)}</span>`;
};

const highlightYamlLine = (line: string): string => {
  const commentIndex = line.indexOf("#");
  const source = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const comment = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const keyMatch = source.match(/^(\s*-\s*|\s*)([A-Za-z_][A-Za-z0-9_-]*)(:\s*)(.*)$/);
  if (keyMatch) {
    const [, prefix, key, colon, rest] = keyMatch;
    return `${escapeHtml(prefix)}<span style="color:#9CDCFE">${escapeHtml(key)}</span>${escapeHtml(colon)}${highlightYamlValue(rest)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
  }
  const listMatch = source.match(/^(\s*-\s+)(.*)$/);
  if (listMatch) {
    const [, prefix, rest] = listMatch;
    return `${escapeHtml(prefix)}${highlightYamlValue(rest)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
  }
  return `${escapeHtml(source)}${comment ? `<span style="color:#6A9955">${escapeHtml(comment)}</span>` : ""}`;
};

const highlightYaml = (code: string): string => code.split("\n").map(highlightYamlLine).join("\n");

export function ConfigMaps() {
  const { selectedNamespace } = useNamespace();
  const navigate = useNavigate();
  const { resourceType, namespace: detailNamespace, name: detailName } = useParams<{ resourceType?: string; namespace?: string; name?: string }>();
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [activeTab, setActiveTab] = useState<"config" | "secret">("config");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [namespaceOptions, setNamespaceOptions] = useState<string[]>(["default"]);
  const [refreshingNamespaces, setRefreshingNamespaces] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ConfigItem | null>(null);
  const [updateTarget, setUpdateTarget] = useState<ConfigItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConfigItem | null>(null);
  const [detailItem, setDetailItem] = useState<ConfigItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const detailType: ConfigType | null = resourceType === "config" ? "配置项" : resourceType === "secret" ? "密钥" : null;
  const isDetailRoute = Boolean(detailType && detailNamespace && detailName);

  const currentType: ConfigType = activeTab === "config" ? "配置项" : "密钥";
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items
      .filter((item) => item.type === currentType)
      .filter((item) => selectedNamespace === "all" || item.namespace === selectedNamespace)
      .filter((item) => !keyword || [item.name, item.alias, item.namespace, formatLabels(item.labels)].some((value) => value.toLowerCase().includes(keyword)));
  }, [currentType, items, search, selectedNamespace]);

  const loadData = useCallback(async (preserveData = false) => {
    setIsLoading(true);
    setError("");
    try {
      const [namespaceItems, configMaps, secrets] = await Promise.all([listNamespaces(), listConfigMaps(), listSecrets()]);
      const nextNamespaces = namespaceItems.filter((item) => item.value !== "all").map((item) => item.value);
      setNamespaceOptions(nextNamespaces.length ? nextNamespaces : ["default"]);
      setItems([
        ...configMaps.map((item) => toConfigItem(item, "配置项")),
        ...secrets.map((item) => toConfigItem(item, "密钥")),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载配置项与密钥失败");
      if (!preserveData) setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async () => {
    if (!detailType || !detailNamespace || !detailName) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const resource = detailType === "密钥"
        ? await getSecret(detailNamespace, detailName)
        : await getConfigMap(detailNamespace, detailName);
      setDetailItem(toConfigItem(resource, detailType));
    } catch (err) {
      setDetailItem(null);
      setDetailError(err instanceof Error ? err.message : `加载${detailType}详情失败`);
    } finally {
      setDetailLoading(false);
    }
  }, [detailName, detailNamespace, detailType]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isDetailRoute) {
        void loadDetail();
      } else {
        setDetailItem(null);
        void loadData();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isDetailRoute, loadData, loadDetail]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData(true);
    } finally {
      setRefreshing(false);
    }
  };

  const handleNamespaceRefresh = async () => {
    setRefreshingNamespaces(true);
    try {
      await loadData(true);
    } finally {
      setRefreshingNamespaces(false);
    }
  };

  const getExactItem = async (item: ConfigItem) => {
    const resource = item.type === "密钥"
      ? await getSecret(item.namespace, item.name)
      : await getConfigMap(item.namespace, item.name);
    return toConfigItem(resource, item.type);
  };

  const openYamlEditor = async (item: ConfigItem) => {
    setMenuOpenId(null);
    setError("");
    try {
      setYamlTarget(await getExactItem(item));
    } catch (err) {
      setError(err instanceof Error ? err.message : `加载${item.type}详情失败`);
    }
  };

  const openUpdateDialog = async (item: ConfigItem) => {
    setMenuOpenId(null);
    setError("");
    try {
      setUpdateTarget(await getExactItem(item));
    } catch (err) {
      setError(err instanceof Error ? err.message : `加载${item.type}详情失败`);
    }
  };

  const exportExactItem = async (item: ConfigItem) => {
    setMenuOpenId(null);
    setError("");
    try {
      handleExport(await getExactItem(item));
    } catch (err) {
      setError(err instanceof Error ? err.message : `导出${item.type}失败`);
    }
  };

  const handleCreate = async (form: ConfigForm) => {
    setIsLoading(true);
    setError("");
    try {
      const resource = buildConfigResource(form, currentType);
      if (currentType === "密钥") {
        await createSecretResource(resource);
      } else {
        await createConfigMapResource(resource);
      }
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `创建${currentType}失败`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (_id: string, form: ConfigForm) => {
    if (!updateTarget) return;
    setIsLoading(true);
    setError("");
    try {
      const resource = buildUpdatedConfigResource(updateTarget, form);
      if (updateTarget.type === "密钥") {
        await updateSecretResource(updateTarget.namespace, resource);
      } else {
        await updateConfigMapResource(updateTarget.namespace, resource);
      }
      setUpdateTarget(null);
      if (isDetailRoute) await loadDetail();
      else await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `更新${updateTarget.type}失败`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleYamlUpdate = async (target: ConfigItem, source: string) => {
    setIsLoading(true);
    setError("");
    try {
      const parsed = parseResourceYaml(source, target.type);
      const type = parsed.type;
      if (type !== target.type) throw new Error(`${target.type}不能通过 YAML 修改为${type}`);
      const resource: KubeResource = {
        ...(target.raw || {}),
        ...parsed.resource,
        metadata: {
          ...(target.raw?.metadata || {}),
          ...(parsed.resource.metadata || {}),
          name: target.name,
          namespace: target.namespace,
        },
      };
      const metadata = resource.metadata as KubeResource["metadata"] & { managedFields?: unknown };
      if (metadata) delete metadata.managedFields;
      if (type === "密钥") {
        await updateSecretResource(target.namespace, resource);
      } else {
        await updateConfigMapResource(target.namespace, resource);
      }
      setYamlTarget(null);
      if (isDetailRoute) await loadDetail();
      else await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "YAML 更新失败");
    } finally {
      setIsLoading(false);
    }
  };

  const requestDelete = (item: ConfigItem) => {
    setDeleteTarget(item);
    setMenuOpenId(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsLoading(true);
    setError("");
    try {
      if (deleteTarget.type === "密钥") {
        await deleteSecretResource(deleteTarget.namespace, deleteTarget.name);
      } else {
        await deleteConfigMapResource(deleteTarget.namespace, deleteTarget.name);
      }
      setDeleteTarget(null);
      if (isDetailRoute) navigate("/configmaps");
      else await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `删除${deleteTarget.type}失败`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = (item: ConfigItem) => {
    downloadTextFile(`${item.name}.yaml`, buildConfigYaml(item));
    setMenuOpenId(null);
  };

  const handleYamlCreate = async (source: string) => {
    setIsLoading(true);
    setError("");
    try {
      const { resource, type } = parseResourceYaml(source, currentType);
      if (type === "密钥") {
        await createSecretResource(resource);
      } else {
        await createConfigMapResource(resource);
      }
      setYamlOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "YAML 创建失败");
    } finally {
      setIsLoading(false);
    }
  };

  if (isDetailRoute) {
    return (
      <>
        <ConfigItemDetailPage
          item={detailItem}
          loading={detailLoading}
          error={detailError || error}
          onBack={() => navigate("/configmaps")}
          onEditYaml={() => detailItem && setYamlTarget(detailItem)}
          onUpdate={() => detailItem && setUpdateTarget(detailItem)}
          onExport={() => detailItem && handleExport(detailItem)}
          onDelete={() => detailItem && requestDelete(detailItem)}
        />
        <YamlCreateDialog
          open={!!yamlTarget}
          title={yamlTarget ? `编辑 YAML - ${yamlTarget.name}` : "编辑 YAML"}
          type={yamlTarget?.type || detailType || "配置项"}
          defaultValue={yamlTarget ? buildConfigYaml(yamlTarget) : undefined}
          onOpenChange={(open) => !open && setYamlTarget(null)}
          onSubmit={(source) => yamlTarget && handleYamlUpdate(yamlTarget, source)}
        />
        <CreateConfigItemDialog
          open={!!updateTarget}
          type={updateTarget?.type || detailType || "配置项"}
          mode="update"
          initialItem={updateTarget}
          namespaces={Array.from(new Set([updateTarget?.namespace || detailNamespace || "default", ...namespaceOptions]))}
          refreshingNamespaces={refreshingNamespaces}
          onRefreshNamespaces={handleNamespaceRefresh}
          onOpenChange={(open) => !open && setUpdateTarget(null)}
          onSubmit={(form) => updateTarget && handleUpdate(updateTarget.id, form)}
        />
        <ConfigDeleteDialog target={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={confirmDelete} />
      </>
    );
  }

  return (
    <div className="blueedge-page space-y-5">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-[#111827]">配置项与密钥</h1>
        <p className="text-xs text-[var(--color-text-secondary)]">管理配置数据和敏感凭证</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="segmented-filter">
          <button type="button" onClick={() => setActiveTab("config")} className={cn("segmented-filter-item", activeTab === "config" && "is-active")}>配置项</button>
          <button type="button" onClick={() => setActiveTab("secret")} className={cn("segmented-filter-item", activeTab === "secret" && "is-active")}>密钥</button>
        </div>
        <div className="flex items-center gap-2">
          <div className="toolbar-search relative w-[240px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeTab === "config" ? "搜索配置项..." : "搜索密钥..."} className="h-9 bg-white pl-9 text-sm" />
          </div>
          <button type="button" onClick={() => void handleRefresh()} disabled={refreshing || isLoading} className="action-button h-9 w-9" title="刷新">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </button>
          <Button type="button" variant="outline" onClick={() => setYamlOpen(true)} className="h-9 rounded-xl px-4 text-xs font-semibold">YAML 创建</Button>
          <Button type="button" onClick={() => setCreateOpen(true)} className="h-9 rounded-xl bg-[#0f172a] px-4 text-xs font-semibold text-white hover:bg-[#172033]">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {activeTab === "config" ? "创建配置项" : "创建密钥"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">
          {error}
        </div>
      )}

      <div className="table-card overflow-visible">
        <Table>
          <TableHeader>
            <TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
              {activeTab === "config" ? (
                <>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">配置项名称</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">配置项别名</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">标签</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
                </>
              ) : (
                <>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">密钥名称</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">密钥别名</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">标签</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">类型</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">数据数量</TableHead>
                  <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
                </>
              )}
              <TableHead className="w-[90px] px-4 text-right text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={activeTab === "config" ? 6 : 8} className="py-14 text-center">
                  <div className="flex flex-col items-center">
                    <RefreshCw className="mb-3 h-8 w-8 animate-spin text-[var(--color-text-tertiary)]" />
                    <p className="text-sm text-[var(--color-text-secondary)]">加载中...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeTab === "config" ? 6 : 8} className="py-14 text-center">
                  <div className="flex flex-col items-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-bg-soft)]">
                      {activeTab === "config" ? <FileCode2 className="h-6 w-6 text-[var(--color-text-tertiary)]" /> : <ShieldCheck className="h-6 w-6 text-[var(--color-text-tertiary)]" />}
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)]">{activeTab === "config" ? "暂无配置项" : "暂无密钥"}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.map((row) => (
              <TableRow key={row.id} className="h-[72px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
                <TableCell className="px-4 py-3 text-sm font-medium text-[#1e6bff]">
                  <button
                    type="button"
                    onClick={() => navigate(`/configmaps/${row.type === "配置项" ? "config" : "secret"}/${encodeURIComponent(row.namespace)}/${encodeURIComponent(row.name)}`)}
                    className="text-left hover:underline"
                  >
                    {row.name}
                  </button>
                </TableCell>
                <TableCell className="px-4 py-3 text-xs text-[#374151]">{row.alias || "-"}</TableCell>
                {activeTab === "secret" && <TableCell className="px-4 py-3 text-xs text-[#374151]">{row.namespace}</TableCell>}
                <TableCell className="max-w-[360px] truncate px-4 py-3 text-xs text-[var(--color-text-secondary)]" title={formatLabels(row.labels)}>{formatLabels(row.labels)}</TableCell>
                {activeTab === "config" && <TableCell className="px-4 py-3 text-xs text-[#374151]">{row.namespace}</TableCell>}
                {activeTab === "secret" && <TableCell className="px-4 py-3"><span className="rounded-md bg-[var(--color-warning-soft)] px-2 py-0.5 text-xs text-[var(--color-warning)]">Opaque</span></TableCell>}
                {activeTab === "secret" && <TableCell className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">{row.dataCount} Keys</TableCell>}
                <TableCell className="px-4 py-3 text-xs text-[var(--color-text-tertiary)]">{row.createTime}</TableCell>
                <TableCell className="relative px-4 py-3 text-right">
                  <ConfigRowActions
                    open={menuOpenId === row.id}
                    onOpenChange={(open) => setMenuOpenId(open ? row.id : null)}
                    type={row.type}
                    onEditYaml={() => void openYamlEditor(row)}
                    onUpdate={() => void openUpdateDialog(row)}
                    onExport={() => void exportExactItem(row)}
                    onDelete={() => requestDelete(row)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CreateConfigItemDialog open={createOpen} type={currentType} namespaces={namespaceOptions} refreshingNamespaces={refreshingNamespaces} onRefreshNamespaces={handleNamespaceRefresh} onOpenChange={setCreateOpen} onSubmit={handleCreate} />
      <YamlCreateDialog open={yamlOpen} title={activeTab === "config" ? "YAML 创建配置项" : "YAML 创建密钥"} type={currentType} onOpenChange={setYamlOpen} onSubmit={handleYamlCreate} />
      <YamlCreateDialog
        open={!!yamlTarget}
        title={yamlTarget ? `编辑 YAML - ${yamlTarget.name}` : "编辑 YAML"}
        type={yamlTarget?.type || currentType}
        defaultValue={yamlTarget ? buildConfigYaml(yamlTarget) : undefined}
        onOpenChange={(open) => !open && setYamlTarget(null)}
        onSubmit={(source) => yamlTarget && handleYamlUpdate(yamlTarget, source)}
      />
      <CreateConfigItemDialog
        open={!!updateTarget}
        type={updateTarget?.type || currentType}
        mode="update"
        initialItem={updateTarget}
        namespaces={namespaceOptions}
        refreshingNamespaces={refreshingNamespaces}
        onRefreshNamespaces={handleNamespaceRefresh}
        onOpenChange={(open) => !open && setUpdateTarget(null)}
        onSubmit={(form) => updateTarget && handleUpdate(updateTarget.id, form)}
      />
      <ConfigDeleteDialog target={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} onConfirm={confirmDelete} />
    </div>
  );
}

function ConfigDeleteDialog({ target, onOpenChange, onConfirm }: { target: ConfigItem | null; onOpenChange: (open: boolean) => void; onConfirm: () => Promise<void> }) {
  return (
    <AlertDialog open={!!target} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[520px] rounded-[24px]">
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除{target?.type}？</AlertDialogTitle>
          <AlertDialogDescription>
            即将删除 <span className="font-medium text-[var(--color-text-primary)]">{target?.name}</span>
            {target?.mountTargets.length ? `，当前已被 ${target.mountTargets.join("、")} 引用，删除后相关工作负载可能无法读取配置或凭证。` : "，删除成功后将重新拉取最新列表。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-9 rounded-xl">取消</AlertDialogCancel>
          <AlertDialogAction className="h-9 rounded-xl bg-[#ff4d4f] text-white hover:bg-[#dc2626]" onClick={() => void onConfirm()}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConfigDetailTab = "data" | "labels" | "annotations";

function ConfigItemDetailPage({
  item,
  loading,
  error,
  onBack,
  onEditYaml,
  onUpdate,
  onExport,
  onDelete,
}: {
  item: ConfigItem | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onEditYaml: () => void;
  onUpdate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<ConfigDetailTab>("data");
  const [selectedKey, setSelectedKey] = useState("");
  const dataEntries = Object.entries(item?.data || {});
  const labels = item?.labels || {};
  const annotations = item?.raw ? getAnnotations(item.raw) : {};

  if (loading) {
    return <div className="blueedge-page flex min-h-[520px] items-center justify-center"><RefreshCw className="h-9 w-9 animate-spin text-[#94a3b8]" /></div>;
  }

  if (!item) {
    return (
      <div className="blueedge-page space-y-5">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#475569]"><ArrowLeft className="h-4 w-4" />返回列表</button>
        <div className="rounded-2xl border border-[#fecaca] bg-[#fef2f2] px-5 py-5 text-sm text-[#b91c1c]">{error || "配置项不存在或无权访问"}</div>
      </div>
    );
  }

  const effectiveSelectedKey = selectedKey && dataEntries.some(([key]) => key === selectedKey) ? selectedKey : dataEntries[0]?.[0] || "";
  const selectedValue = item.data?.[effectiveSelectedKey] || "";
  const tabItems: Array<{ id: ConfigDetailTab; label: string; icon: typeof Database }> = [
    { id: "data", label: item.type === "配置项" ? "配置数据" : "密钥数据", icon: Database },
    { id: "labels", label: "标签", icon: Tags },
    { id: "annotations", label: "注解", icon: MessageSquareText },
  ];

  return (
    <div className="blueedge-page space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" onClick={onBack} className="action-button h-11 w-11 shrink-0 rounded-xl" title="返回列表"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-xl font-semibold text-[#111827]">{item.name}</h1>
              <span className="rounded-full bg-[#f3f4f6] px-3 py-1 text-xs font-semibold text-[#64748b]">● {item.type}</span>
            </div>
            <p className="mt-1 text-sm text-[#64748b]">{item.namespace} · {item.dataCount} 个数据项</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DetailActionButton icon={FileCode2} label="编辑 YAML" onClick={onEditYaml} />
          <DetailActionButton icon={Pencil} label="更新" onClick={onUpdate} />
          <DetailActionButton icon={Download} label="导出" onClick={onExport} />
          <DetailActionButton icon={Trash2} label="删除" danger onClick={onDelete} />
        </div>
      </div>

      {error && <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{error}</div>}

      <section className="rounded-2xl border border-[#eef2f7] bg-white px-6 py-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
        <h2 className="mb-6 text-base font-semibold text-[#111827]">基础信息</h2>
        <div className="grid grid-cols-4 gap-8">
          <DetailField label={item.type === "配置项" ? "配置项名称" : "密钥名称"} value={item.name} />
          <DetailField label={item.type === "配置项" ? "配置项别名" : "密钥别名"} value={item.alias || "-"} />
          <DetailField label="描述" value={item.description || "-"} />
          <DetailField label="创建时间" value={formatConfigDate(item.createTime)} />
        </div>
      </section>

      <div className="flex items-center gap-2">
        {tabItems.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-semibold", tab === id ? "border-[#0f172a] bg-[#0f172a] text-white" : "border-[#dfe5ee] bg-white text-[#64748b] hover:bg-[#f8fafc]")}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === "data" ? (
        <section className="rounded-2xl border border-[#eef2f7] bg-white px-6 py-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
          <h2 className="mb-6 text-base font-semibold text-[#111827]">数据信息</h2>
          {dataEntries.length === 0 ? <DetailEmptyState text="暂无配置数据" /> : (
            <div className="grid min-h-[360px] grid-cols-[240px_1fr] overflow-hidden rounded-2xl border border-[#e2e8f0]">
              <div className="border-r border-[#e2e8f0] bg-[#fbfcfe]">
                <div className="border-b border-[#e2e8f0] px-5 py-4 text-sm font-semibold text-[#64748b]">Key List</div>
                <div className="space-y-1 p-3">{dataEntries.map(([key]) => (
                  <button key={key} type="button" onClick={() => setSelectedKey(key)} className={cn("block w-full truncate rounded-xl px-4 py-3 text-left text-sm font-semibold", effectiveSelectedKey === key ? "bg-[#eaf2ff] text-[#1e6bff]" : "text-[#334155] hover:bg-[#f1f5f9]")} title={key}>{key}</button>
                ))}</div>
              </div>
              <div className="min-w-0 bg-[#fbfcfe]">
                <div className="flex items-center justify-between border-b border-[#e2e8f0] bg-white px-5 py-3">
                  <div className="flex items-center gap-3"><span className="text-sm font-semibold text-[#334155]">Value</span><span className="rounded-full bg-[#f3f4f6] px-2 py-0.5 text-xs text-[#94a3b8]">YAML</span></div>
                  <CopyButton value={selectedValue} />
                </div>
                <pre className="max-h-[520px] min-h-[306px] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-sm leading-7 text-[#334155]">{selectedValue}</pre>
              </div>
            </div>
          )}
        </section>
      ) : (
        <MetadataDetailTable title={tab === "labels" ? "标签" : "注解"} entries={tab === "labels" ? labels : annotations} />
      )}
    </div>
  );
}

function DetailActionButton({ icon: Icon, label, danger, onClick }: { icon: typeof Pencil; label: string; danger?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold hover:bg-[#f8fafc]", danger ? "border-[#fee2e2] text-[#ff4d4f] hover:bg-[#fff5f5]" : "border-[#dfe5ee] text-[#111827]")}><Icon className="h-4 w-4" />{label}</button>;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><div className="truncate text-base font-semibold text-[#111827]" title={value}>{value}</div><div className="mt-2 text-sm text-[#94a3b8]">{label}</div></div>;
}

function MetadataDetailTable({ title, entries }: { title: string; entries: Record<string, string> }) {
  const rows = Object.entries(entries);
  return (
    <section className="rounded-2xl border border-[#eef2f7] bg-white px-6 py-6 shadow-[0_12px_35px_rgba(15,23,42,0.05)]">
      <h2 className="mb-6 text-base font-semibold text-[#111827]">{title}</h2>
      {rows.length === 0 ? <DetailEmptyState text={`暂无${title}`} /> : (
        <div className="overflow-hidden rounded-2xl border border-[#e2e8f0]">
          <div className="grid grid-cols-[1fr_1.6fr_90px] bg-[#f8fafc] px-5 py-4 text-sm font-semibold text-[#64748b]"><span>Key</span><span>Value</span><span className="text-right">操作</span></div>
          {rows.map(([key, value]) => <div key={key} className="grid grid-cols-[1fr_1.6fr_90px] items-center border-t border-[#e2e8f0] px-5 py-5 text-sm"><span className="break-all font-mono text-[#111827]">{key}</span><span className="break-all text-[#475569]">{value}</span><div className="flex justify-end"><CopyButton value={`${key}=${value}`} compact /></div></div>)}
        </div>
      )}
    </section>
  );
}

function DetailEmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-[#d1d5db] bg-[#fafbfc] px-4 py-20 text-center text-sm text-[#94a3b8]">{text}</div>;
}

function CopyButton({ value, compact = false }: { value: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return <button type="button" onClick={() => void copy()} className={cn("inline-flex items-center justify-center gap-2 rounded-xl border border-[#dfe5ee] bg-white text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]", compact ? "h-9 w-9" : "h-9 px-4")} title="复制"><Copy className="h-4 w-4" />{!compact && (copied ? "已复制" : "复制")}</button>;
}

function formatConfigDate(value: string) {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false }).replaceAll("/", "-");
}

function ConfigRowActions({ open, onOpenChange, type, onEditYaml, onUpdate, onExport, onDelete }: { open: boolean; onOpenChange: (open: boolean) => void; type: ConfigType; onEditYaml: () => void; onUpdate: () => void; onExport: () => void; onDelete: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const toggleMenu = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 164;
      const menuHeight = 206;
      const viewportPadding = 12;
      const gap = 8;
      const canOpenDown = rect.bottom + gap + menuHeight <= window.innerHeight - viewportPadding;
      setMenuPosition({
        top: canOpenDown ? rect.bottom + gap : Math.max(viewportPadding, rect.top - gap - menuHeight),
        left: Math.max(16, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 16)),
      });
    }
    onOpenChange(!open);
  };

  return (
    <div className="inline-block text-left">
      <button ref={buttonRef} type="button" onClick={toggleMenu} className="action-button ml-auto h-9 w-9" title="更多操作">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-30 cursor-default" onClick={() => onOpenChange(false)} aria-label="关闭菜单" />
          <ConfigActionMenu top={menuPosition.top} left={menuPosition.left} type={type} onEditYaml={onEditYaml} onUpdate={onUpdate} onExport={onExport} onDelete={onDelete} />
        </>
      )}
    </div>
  );
}

function ConfigActionMenu({ top, left, type, onEditYaml, onUpdate, onExport, onDelete }: { top: number; left: number; type: ConfigType; onEditYaml: () => void; onUpdate: () => void; onExport: () => void; onDelete: () => void }) {
  return (
    <div className="fixed z-40 w-[164px] overflow-hidden rounded-xl border border-[#e5e7eb] bg-white py-2 text-left shadow-[0_18px_45px_rgba(15,23,42,0.16)]" style={{ top, left }}>
      <button type="button" onClick={onEditYaml} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#f8fafc]"><Edit3 className="h-4 w-4 text-[#94a3b8]" />编辑 YAML</button>
      <button type="button" onClick={onUpdate} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#f8fafc]"><Pencil className="h-4 w-4 text-[#94a3b8]" />更新</button>
      <div className="my-1 border-t border-[#eef2f7]" />
      <button type="button" onClick={onExport} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-[#f8fafc]"><Download className="h-4 w-4 text-[#94a3b8]" />导出{type}</button>
      <div className="my-1 border-t border-[#eef2f7]" />
      <button type="button" onClick={onDelete} className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-[#ff4d4f] hover:bg-[#fff5f5]"><Trash2 className="h-4 w-4" />删除</button>
    </div>
  );
}

function CreateConfigItemDialog({
  open,
  type,
  mode = "create",
  initialItem,
  namespaces,
  refreshingNamespaces,
  onRefreshNamespaces,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  type: ConfigType;
  mode?: "create" | "update";
  initialItem?: ConfigItem | null;
  namespaces: string[];
  refreshingNamespaces: boolean;
  onRefreshNamespaces: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: ConfigForm) => void;
}) {
  const initialForm = useMemo<ConfigForm>(() => initialItem ? {
    name: initialItem.name,
    alias: initialItem.alias,
    namespace: initialItem.namespace,
    description: initialItem.description || "",
    dataPairs: initialItem.type === "密钥"
      ? Object.keys(initialItem.data || {}).map((key, index) => ({ id: `data-${index}-${key}`, key, value: "" }))
      : recordToPairs(initialItem.data, "data"),
    labels: recordToPairs(initialItem.labels, "label"),
    annotations: initialItem.raw ? recordToPairs(getEditableAnnotations(initialItem.raw), "annotation") : [],
  } : emptyForm(), [initialItem]);
  const [form, setForm] = useState<ConfigForm>(() => initialForm);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isConfig = type === "配置项";
  const nameError = !form.name.trim()
    ? "请输入名称"
    : form.name.length > 63 || !namePattern.test(form.name)
      ? "名称最长 63 个字符，必须由小写字母、数字字符、“-” 或 “.” 组成，并以小写字母或数字开头及结尾"
      : "";
  const dataValid = validatePairs(form.dataPairs);
  const canSubmit = !nameError && Boolean(form.namespace) && dataValid;

  const update = (patch: Partial<ConfigForm>) => setForm((current) => ({ ...current, ...patch }));
  const close = () => onOpenChange(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setForm(initialForm);
      setSubmitted(false);
      onOpenChange(true);
      return;
    }
    close();
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      update({ dataPairs: [...form.dataPairs, { id: `data-${Date.now()}`, key: file.name, value: String(readerEvent.target?.result || "") }] });
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const handleSubmit = () => {
    setSubmitted(true);
    if (!canSubmit) return;
    onSubmit(form);
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setForm(initialForm);
      setSubmitted(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialForm, open]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="!flex max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_32px_80px_rgba(0,0,0,0.2)] sm:max-w-none"
        style={{ width: "min(860px, calc(100vw - 48px))", height: "min(720px, calc(100vh - 48px))" }}
        showCloseButton={false}
      >
        <DialogHeader className="h-14 shrink-0 border-b border-[#f0f1f3] px-7 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-lg font-semibold text-[#111827]">{mode === "update" ? `更新${type}` : isConfig ? "创建配置项" : "创建密钥"}</DialogTitle>
            <button type="button" onClick={close} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e5e7eb] text-[#64748b] hover:bg-[#f8fafc]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="space-y-5">
            <div>
              <CreateLabel label="名称" required />
              <Input value={form.name} onChange={(event) => update({ name: event.target.value })} disabled={mode === "update"} placeholder="请输入名称" className={cn("h-11 rounded-[12px] border-2 border-[#e2e8f0] px-4 text-sm shadow-sm focus-visible:ring-0", submitted && nameError && "border-[#ef4444]")} />
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">名称最长 63 个字符；必须由小写字母、数字字符、“-” 或 “.” 组成；必须以小写字母或数字字符开头及结尾。</p>
              {submitted && nameError && <p className="mt-1 text-xs text-[#ef4444]">{nameError}</p>}
            </div>

            <div className="grid grid-cols-[1fr_1fr] gap-5">
              <div>
                <CreateLabel label={isConfig ? "配置项别名" : "密钥别名"} />
                <Input value={form.alias} onChange={(event) => update({ alias: event.target.value })} className="h-11 rounded-[12px] border-2 border-[#e2e8f0] px-4 text-sm shadow-sm focus-visible:ring-0" />
              </div>
              <div>
                <CreateLabel label="命名空间" required />
                <div className="flex gap-2">
                  <select value={form.namespace} onChange={(event) => update({ namespace: event.target.value })} disabled={mode === "update"} className="blueedge-native-select h-11 flex-1 rounded-[12px] border-2 px-4 text-sm">
                    {namespaces.map((namespace) => <option key={namespace} value={namespace}>{namespace}</option>)}
                  </select>
                  <button type="button" onClick={() => void onRefreshNamespaces()} disabled={refreshingNamespaces} className="action-button h-11 w-11 rounded-[12px]" title="刷新命名空间">
                    <RefreshCw className={cn("h-4 w-4", refreshingNamespaces && "animate-spin")} />
                  </button>
                </div>
              </div>
            </div>

            <div>
              <CreateLabel label="描述" />
              <Textarea value={form.description} onChange={(event) => update({ description: event.target.value })} placeholder="请输入描述信息" className="h-[112px] min-h-[112px] rounded-[12px] border-2 border-[#e2e8f0] px-4 py-3 text-sm shadow-sm focus-visible:ring-0" />
            </div>

            <ConfigSection
              title={isConfig ? "配置数据" : "密钥数据"}
              action={(
                <>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-[#dfe5ee] bg-white px-5 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">
                    <Upload className="h-4 w-4" />
                    上传文件
                  </button>
                </>
              )}
            >
              <KvEditor pairs={form.dataPairs} onChange={(pairs) => update({ dataPairs: pairs })} />
              {submitted && !dataValid && <p className="mt-2 text-xs text-[#ef4444]">存在未填写完整的数据，且 key 不允许重复</p>}
            </ConfigSection>

            <ConfigSection title="标签">
              <KvEditor pairs={form.labels} onChange={(pairs) => update({ labels: pairs })} />
            </ConfigSection>

            <ConfigSection title="注解">
              <KvEditor pairs={form.annotations} onChange={(pairs) => update({ annotations: pairs })} />
            </ConfigSection>
          </div>
        </div>

        <DialogFooter className="h-16 shrink-0 border-t border-[#f0f1f3] bg-white px-7 py-0">
          <div className="flex w-full justify-end gap-3">
            <button type="button" onClick={close} className="h-10 rounded-xl border border-[#dfe5ee] bg-white px-6 text-sm font-semibold text-[#111827] hover:bg-[#f8fafc]">取消</button>
            <button type="button" onClick={handleSubmit} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033] disabled:cursor-not-allowed disabled:bg-[#9ca3af]" disabled={!canSubmit}>{mode === "update" ? "更新" : "创建"}</button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Label className="mb-2 block text-sm font-semibold text-[#111827]">
      {label}
      {required && <span className="ml-1 text-[#ff4d4f]">*</span>}
    </Label>
  );
}

function ConfigSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e5e7eb] bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[#111827]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function KvEditor({ pairs, onChange }: { pairs: KvPair[]; onChange: (pairs: KvPair[]) => void }) {
  const duplicate = hasDuplicateKeys(pairs);
  const add = () => onChange([...pairs, { id: `kv-${Date.now()}`, key: "", value: "" }]);
  const remove = (id: string) => onChange(pairs.filter((pair) => pair.id !== id));
  const update = (id: string, patch: Partial<KvPair>) => onChange(pairs.map((pair) => pair.id === id ? { ...pair, ...patch } : pair));

  return (
    <div className="space-y-3">
      {pairs.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[#d1d5db] bg-[#fafbfc] px-3 py-11 text-center">
          <span className="text-sm text-[var(--color-text-tertiary)]">暂无数据</span>
        </div>
      ) : pairs.map((pair) => {
        const incomplete = Boolean(pair.key.trim()) !== Boolean(pair.value.trim());
        return (
          <div key={pair.id} className="space-y-1">
            <div className="grid grid-cols-[1fr_1fr_44px] gap-3">
              <Input value={pair.key} onChange={(event) => update(pair.id, { key: event.target.value })} placeholder="键" className={cn("h-11 rounded-[12px] border-2 border-[#e2e8f0] bg-[#f8fafc] px-4 text-sm shadow-sm focus-visible:ring-0", incomplete && "border-[#ef4444]")} />
              <Input value={pair.value} onChange={(event) => update(pair.id, { value: event.target.value })} placeholder="值" className={cn("h-11 rounded-[12px] border-2 border-[#e2e8f0] bg-[#f8fafc] px-4 text-sm shadow-sm focus-visible:ring-0", incomplete && "border-[#ef4444]")} />
              <button type="button" onClick={() => remove(pair.id)} className="action-button h-11 w-11 rounded-[12px]"><Trash2 className="h-4 w-4" /></button>
            </div>
            {incomplete && <p className="text-xs text-[#ef4444]">未填写完整</p>}
          </div>
        );
      })}
      {duplicate && <p className="text-xs text-[#ef4444]">同一分组内 key 不允许重复</p>}
      <button type="button" onClick={add} className="mt-2 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-[#f8fafc]">
        <Plus className="h-4 w-4" />
        添加
      </button>
    </div>
  );
}

function hasDuplicateKeys(pairs: KvPair[]) {
  const keys = pairs.map((pair) => pair.key.trim()).filter(Boolean);
  return new Set(keys).size !== keys.length;
}

function validatePairs(pairs: KvPair[]) {
  if (hasDuplicateKeys(pairs)) return false;
  return pairs.every((pair) => {
    if (!pair.key.trim() && !pair.value.trim()) return true;
    return Boolean(pair.key.trim() && pair.value.trim());
  });
}

const defaultConfigYaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  key1: value1`;

const defaultSecretYaml = `apiVersion: v1
kind: Secret
metadata:
  name: app-secret
  namespace: default
type: Opaque
stringData:
  username: admin
  password: changeme`;

function YamlCreateDialog({
  open,
  title,
  type,
  defaultValue,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  type: ConfigType;
  defaultValue?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (yaml: string) => void;
}) {
  const [yaml, setYaml] = useState(defaultValue || (type === "密钥" ? defaultSecretYaml : defaultConfigYaml));
  const [fullscreen, setFullscreen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lineGutterRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLPreElement>(null);
  const lineCount = Math.max(19, yaml.split("\n").length);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setYaml(defaultValue || (type === "密钥" ? defaultSecretYaml : defaultConfigYaml)), 0);
    return () => window.clearTimeout(timer);
  }, [defaultValue, open, type]);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setYaml(String(reader.result || ""));
    reader.readAsText(file);
    event.target.value = "";
  };

  const handleDownload = () => {
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = type === "密钥" ? "secret.yaml" : "configmap.yaml";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!flex max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0 shadow-[0_32px_80px_rgba(0,0,0,0.2)] sm:max-w-none"
        style={fullscreen ? { width: "calc(100vw - 32px)", height: "calc(100vh - 32px)" } : { width: "min(920px, calc(100vw - 48px))", height: "min(720px, calc(100vh - 48px))" }}
        showCloseButton={false}
      >
        <DialogHeader className="h-14 shrink-0 border-b border-[#f0f1f3] px-5 py-0">
          <div className="flex h-full items-center justify-between">
            <DialogTitle className="text-base font-semibold text-[#111827]">{title}</DialogTitle>
            <div className="flex shrink-0 items-center gap-1">
              <input ref={fileInputRef} type="file" accept=".yaml,.yml" className="hidden" onChange={handleUpload} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[#4b5563] hover:bg-[#f8fafc]">
                <Upload className="h-3.5 w-3.5" />
                上传
              </button>
              <button type="button" onClick={handleDownload} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[#4b5563] hover:bg-[#f8fafc]">
                <Download className="h-3.5 w-3.5" />
                下载
              </button>
              <button type="button" onClick={() => setFullscreen((current) => !current)} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-[#4b5563] hover:bg-[#f8fafc]">
                {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {fullscreen ? "退出全屏" : "全屏"}
              </button>
              <div className="mx-1 h-5 w-px bg-[#e5e7eb]" />
              <button type="button" onClick={() => onOpenChange(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9ca3af] hover:bg-[#f8fafc] hover:text-[#64748b]">
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
          <div className="mb-3 flex shrink-0 items-center gap-3 rounded-xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#1d4ed8]">
            <Info className="h-[18px] w-[18px] text-[#3b82f6]" />
            <span>为保证工作负载能被正常调度，请先阅读</span>
            <a href="https://docs.daocloud.io/kant/user-guide/edge-app/create-app.html#yaml" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#2563eb] hover:underline">
              YAML 创建须知 <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-[#1e1e1e]">
            <div className="flex h-full min-h-0 overflow-hidden">
              <div className="w-12 shrink-0 select-none overflow-hidden text-right font-mono text-xs leading-6 text-[#858585]">
                <div ref={lineGutterRef} className="py-3">
                  {Array.from({ length: lineCount }, (_, index) => <div key={index} className="px-2">{index + 1}</div>)}
                </div>
              </div>
              <div className="relative min-w-0 flex-1">
                <pre
                  ref={previewRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden p-3 font-mono text-xs leading-6"
                  style={{ color: "#d4d4d4", whiteSpace: "pre", overflowWrap: "normal", tabSize: 2, zIndex: 1 }}
                  dangerouslySetInnerHTML={{ __html: highlightYaml(yaml) }}
                />
                <textarea
                  value={yaml}
                  onChange={(event) => setYaml(event.target.value)}
                  onScroll={(event) => {
                    if (lineGutterRef.current) lineGutterRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
                    if (previewRef.current) {
                      previewRef.current.scrollTop = event.currentTarget.scrollTop;
                      previewRef.current.scrollLeft = event.currentTarget.scrollLeft;
                    }
                  }}
                  spellCheck={false}
                  wrap="off"
                  className="absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-6 outline-none"
                  style={{ color: "transparent", caretColor: "#d4d4d4", whiteSpace: "pre", overflowWrap: "normal", tabSize: 2, zIndex: 2 }}
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="h-16 shrink-0 border-t border-[#f0f1f3] bg-white px-5 py-0">
          <div className="flex w-full justify-end gap-3">
            <button type="button" onClick={() => onOpenChange(false)} className="h-10 rounded-xl bg-[#f8fafc] px-6 text-sm font-semibold text-[#111827] hover:bg-[#eef2f7]">取消</button>
            <button type="button" onClick={() => onSubmit(yaml)} className="h-10 rounded-xl bg-[#0f172a] px-6 text-sm font-semibold text-white hover:bg-[#172033]">确定</button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
