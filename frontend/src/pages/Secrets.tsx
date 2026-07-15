import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, Copy, Eye, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { getResourceCreatedAt, getResourceName, getResourceNamespace } from "@/api/adapters/kube-resource.adapter";
import { createSecretResource, deleteSecretResource, getSecret, listSecrets, updateSecretResource } from "@/api/services/resources";
import { useNamespaceOptions } from "@/hooks/useNamespaceOptions";
import { cn } from "@/lib/utils";
import type { KubeResource } from "@/types/kubeedge";
import { useNamespace } from "@/contexts/NamespaceContext";

interface SecretRow {
  namespace: string;
  name: string;
  type: string;
  keys: string[];
  createdAt: string;
  raw: KubeResource;
}

function toRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [key, String(item)]),
  );
}

function decodeBase64(value: string): string {
  try {
    return decodeURIComponent(
      Array.from(atob(value))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
  } catch {
    return "";
  }
}

function parseKeyValues(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index).trim(), line.slice(index + 1)];
      })
      .filter(([key]) => key),
  );
}

function encodeBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function formatSecretValues(data: Record<string, string>): string {
  return Object.entries(data).map(([key, value]) => `${key}=${decodeBase64(value)}`).join("\n");
}

function parseDockerConfigText(text: string): string {
  const values = parseKeyValues(text);
  const dockerConfig = values[".dockerconfigjson"] || text.trim();
  if (!dockerConfig) throw new Error("Docker config JSON 不能为空");

  try {
    return JSON.stringify(JSON.parse(dockerConfig));
  } catch {
    const decoded = decodeBase64(dockerConfig);
    if (decoded) {
      try {
        return JSON.stringify(JSON.parse(decoded));
      } catch {
        // fall through to the explicit error below
      }
    }
  }

  throw new Error(".dockerconfigjson 必须是合法 JSON，或填写已 base64 编码的合法 JSON");
}

function buildDockerConfig(form: SecretFormState): string {
  if (form.dataText.trim()) return parseDockerConfigText(form.dataText);
  if (!form.dockerServer.trim() || !form.dockerUsername.trim() || !form.dockerPassword) {
    throw new Error("Docker 镜像仓库地址、用户名和密码不能为空");
  }

  return JSON.stringify({
    auths: {
      [form.dockerServer.trim()]: {
        username: form.dockerUsername.trim(),
        password: form.dockerPassword,
        ...(form.dockerEmail.trim() ? { email: form.dockerEmail.trim() } : {}),
        auth: encodeBase64(`${form.dockerUsername.trim()}:${form.dockerPassword}`),
      },
    },
  });
}

function toSecret(item: any): SecretRow {
  const data = toRecord(item?.data);
  const stringData = toRecord(item?.stringData);
  return {
    namespace: getResourceNamespace(item),
    name: getResourceName(item),
    type: typeof item?.type === "string" ? item.type : "Opaque",
    keys: [...Object.keys(data), ...Object.keys(stringData)],
    createdAt: getResourceCreatedAt(item),
    raw: item,
  };
}

interface SecretFormState {
  name: string;
  namespace: string;
  type: string;
  dataText: string;
  dockerServer: string;
  dockerUsername: string;
  dockerPassword: string;
  dockerEmail: string;
}

function buildSecretResource(form: SecretFormState, base?: KubeResource): KubeResource {
  const type = form.type || "Opaque";
  const next: KubeResource = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      ...base?.metadata,
      name: form.name,
      namespace: form.namespace,
    },
    type,
  };

  delete next.data;
  delete next.stringData;

  if (type === "kubernetes.io/dockerconfigjson") {
    const dockerConfig = buildDockerConfig(form);
    next.data = {
      ".dockerconfigjson": encodeBase64(dockerConfig),
    };
    return next;
  }

  next.stringData = parseKeyValues(form.dataText);
  return next;
}

function emptySecretForm(): SecretFormState {
  return {
    name: "",
    namespace: "default",
    type: "Opaque",
    dataText: "username=admin\npassword=changeme",
    dockerServer: "",
    dockerUsername: "",
    dockerPassword: "",
    dockerEmail: "",
  };
}

function parseDockerForm(data: Record<string, string>): Pick<SecretFormState, "dockerServer" | "dockerUsername" | "dockerPassword" | "dockerEmail" | "dataText"> {
  const decoded = decodeBase64(data[".dockerconfigjson"] || "");
  try {
    const config = JSON.parse(decoded);
    const server = Object.keys(config?.auths || {})[0] || "";
    const auth = server ? config.auths[server] || {} : {};
    return {
      dockerServer: server,
      dockerUsername: typeof auth.username === "string" ? auth.username : "",
      dockerPassword: typeof auth.password === "string" ? auth.password : "",
      dockerEmail: typeof auth.email === "string" ? auth.email : "",
      dataText: decoded ? `.dockerconfigjson=${decoded}` : "",
    };
  } catch {
    return {
      dockerServer: "",
      dockerUsername: "",
      dockerPassword: "",
      dockerEmail: "",
      dataText: decoded ? `.dockerconfigjson=${decoded}` : "",
    };
  }
}

function yaml(row: SecretRow) {
  return `apiVersion: v1
kind: Secret
metadata:
  name: ${row.name}
  namespace: ${row.namespace}
type: ${row.type}
data:
${row.keys.map((key) => `  ${key}: ******`).join("\n") || "  {}"}`;
}

export function Secrets() {
  const namespaces = useNamespaceOptions();
  const [data, setData] = useState<SecretRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { selectedNamespace: namespace } = useNamespace();
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<SecretRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<SecretRow | null>(null);
  const [editItem, setEditItem] = useState<SecretRow | null>(null);
  const [form, setForm] = useState<SecretFormState>(emptySecretForm());
  const [editForm, setEditForm] = useState<SecretFormState>(emptySecretForm());
  const pageSize = 10;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const items = await listSecrets(namespace === "all" ? undefined : namespace);
      setData(items.map(toSecret));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载 Secret 失败");
    } finally {
      setIsLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return data;
    return data.filter((item) =>
      item.name.toLowerCase().includes(keyword) ||
      item.namespace.toLowerCase().includes(keyword) ||
      item.type.toLowerCase().includes(keyword) ||
      item.keys.some((key) => key.toLowerCase().includes(keyword)),
    );
  }, [data, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (row: SecretRow) => {
    setSelected(row);
    setDetailOpen(true);
    try {
      setSelected(toSecret(await getSecret(row.namespace, row.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载 Secret 详情失败");
    }
  };

  const openEdit = async (row: SecretRow) => {
    setIsLoading(true);
    setError("");
    try {
      const detail = toSecret(await getSecret(row.namespace, row.name));
      const secretData = toRecord(detail.raw.data);
      const dockerForm = detail.type === "kubernetes.io/dockerconfigjson"
        ? parseDockerForm(secretData)
        : { dockerServer: "", dockerUsername: "", dockerPassword: "", dockerEmail: "", dataText: formatSecretValues(secretData) };
      setEditItem(detail);
      setEditForm({
        name: detail.name,
        namespace: detail.namespace,
        type: detail.type,
        ...dockerForm,
      });
      setEditOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载 Secret 详情失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    setIsLoading(true);
    setError("");
    try {
      await createSecretResource(buildSecretResource(form));
      setCreateOpen(false);
      setForm(emptySecretForm());
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建 Secret 失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!editItem) return;
    setIsLoading(true);
    setError("");
    try {
      await updateSecretResource(editItem.namespace, buildSecretResource(editForm, editItem.raw));
      setEditOpen(false);
      setEditItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新 Secret 失败");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteItem) return;
    setIsLoading(true);
    setError("");
    try {
      await deleteSecretResource(deleteItem.namespace, deleteItem.name);
      setDeleteOpen(false);
      setDeleteItem(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除 Secret 失败");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="blueedge-page space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Secrets</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="blueedge-muted-button h-9 px-3 text-sm" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />
            刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="blueedge-primary-button h-9 px-3 text-sm"><Plus className="w-3.5 h-3.5 mr-1" />创建 Secret</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">创建 Secret</DialogTitle></DialogHeader>
              <SecretForm form={form} setForm={setForm} namespaces={namespaces} />
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>取消</Button><Button size="sm"  onClick={handleCreate} disabled={!form.name}>创建</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="text-base">编辑 Secret</DialogTitle></DialogHeader>
              <SecretForm form={editForm} setForm={setEditForm} namespaces={namespaces} readonly />
              <DialogFooter><Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>取消</Button><Button size="sm"  onClick={handleUpdate}>保存</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="toolbar-search relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" /><Input placeholder="请输入名称、类型或 Key 搜索" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-9 bg-white pl-9 text-sm" /></div>
        <div className="flex items-center gap-3"><span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span></div>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="table-card">
        <Table><TableHeader><TableRow className="h-12 bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">命名空间</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">名称</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">类型</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">Key 数</TableHead>
          <TableHead className="px-4 text-xs font-medium text-[var(--color-text-tertiary)]">创建时间</TableHead>
          <TableHead className="w-[150px] px-4 text-xs font-medium text-[var(--color-text-tertiary)]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">正在加载 Secret...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={6} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无 Secret 数据</TableCell></TableRow>) : paginated.map((row) => (
          <TableRow key={`${row.namespace}/${row.name}`} className="h-[69px] border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-bg-hover)]">
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.namespace}</TableCell>
            <TableCell className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--color-brand)] hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-normal border-[var(--color-brand-light)] bg-[var(--color-brand-light)] text-[var(--color-brand)]">{row.type}</Badge></TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.keys.length}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><div className="action-group"><button type="button" className="action-button" title="查看详情" onClick={() => openDetail(row)}><Eye className="h-3.5 w-3.5" /></button><button type="button" className="action-button" title="编辑" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></button><button type="button" className="action-button is-danger" title="删除" onClick={() => { setDeleteItem(row); setDeleteOpen(true); }}><Trash2 className="h-3.5 w-3.5" /></button></div></TableCell>
          </TableRow>
        ))}</TableBody></Table>
      </div>
      {filtered.length > pageSize && <Pager page={page} totalPages={totalPages} start={start} pageSize={pageSize} total={filtered.length} setPage={setPage} />}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[620px] sm:max-w-[620px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle><div className="flex items-center gap-2 mt-2"><Badge variant="outline" className="text-xs font-normal">{selected?.namespace}</Badge><Badge variant="outline" className="text-xs font-normal">{selected?.type}</Badge></div></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="keys" className="text-xs h-7">Keys</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3"><div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="命名空间" value={selected.namespace} /><Info label="类型" value={selected.type} /><Info label="Key 数" value={String(selected.keys.length)} /></div></TabsContent>
            <TabsContent value="keys" className="mt-3"><div className="flex flex-wrap gap-2">{selected.keys.length === 0 ? <span className="text-sm text-[var(--color-text-tertiary)]">-</span> : selected.keys.map((key) => (<Badge key={key} variant="secondary" className="text-xs font-normal bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)]">{key}</Badge>))}</div></TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="text-base">确认删除 Secret？</AlertDialogTitle><AlertDialogDescription className="text-sm">即将删除 Secret <span className="font-medium text-[var(--color-text-primary)]">{deleteItem?.name}</span>（命名空间：{deleteItem?.namespace}），此操作不可恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="h-8 text-sm">取消</AlertDialogCancel><AlertDialogAction className="h-8 text-sm" onClick={confirmDelete}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SecretForm({ form, setForm, namespaces, readonly = false }: { form: SecretFormState; setForm: (form: SecretFormState) => void; namespaces: Array<{ value: string; label: string }>; readonly?: boolean }) {
  const isDockerConfig = form.type === "kubernetes.io/dockerconfigjson";
  return (
    <div className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">名称</Label><Input placeholder="如 app-secret" value={form.name} disabled={readonly} onChange={(e) => setForm({ ...form, name: e.target.value })} className={cn("h-9 text-sm", readonly && "bg-[var(--color-bg-soft)]")} /></div>
        <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">命名空间</Label><select value={form.namespace} disabled={readonly} onChange={(e) => setForm({ ...form, namespace: e.target.value })} className="blueedge-native-select">{namespaces.filter((item) => item.value !== "all").map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}</select></div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-[var(--color-text-secondary)]">类型</Label>
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value, dataText: e.target.value === "kubernetes.io/dockerconfigjson" ? "" : form.dataText })}
          className="blueedge-native-select"
        >
          <option value="Opaque">Opaque</option>
          <option value="kubernetes.io/dockerconfigjson">kubernetes.io/dockerconfigjson</option>
          <option value="kubernetes.io/tls">kubernetes.io/tls</option>
          <option value="kubernetes.io/basic-auth">kubernetes.io/basic-auth</option>
          <option value="kubernetes.io/ssh-auth">kubernetes.io/ssh-auth</option>
        </select>
      </div>
      {isDockerConfig ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">镜像仓库地址</Label><Input placeholder="如 https://index.docker.io/v1/" value={form.dockerServer} onChange={(e) => setForm({ ...form, dockerServer: e.target.value })} className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">邮箱</Label><Input placeholder="可选" value={form.dockerEmail} onChange={(e) => setForm({ ...form, dockerEmail: e.target.value })} className="h-9 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">用户名</Label><Input value={form.dockerUsername} onChange={(e) => setForm({ ...form, dockerUsername: e.target.value })} className="h-9 text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">密码</Label><Input type="password" value={form.dockerPassword} onChange={(e) => setForm({ ...form, dockerPassword: e.target.value })} className="h-9 text-sm" /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--color-text-secondary)]">.dockerconfigjson（可选，填写后优先使用）</Label>
            <Textarea
              placeholder='.dockerconfigjson={"auths":{"https://index.docker.io/v1/":{"username":"xxx","password":"xxx","auth":"base64"}}}'
              value={form.dataText}
              onChange={(e) => setForm({ ...form, dataText: e.target.value })}
              className="min-h-28 text-sm font-mono"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5"><Label className="text-xs text-[var(--color-text-secondary)]">数据（每行一组 key=value）</Label><Textarea value={form.dataText} onChange={(e) => setForm({ ...form, dataText: e.target.value })} className="min-h-40 text-sm font-mono" /></div>
      )}
    </div>
  );
}

function Pager({ page, totalPages, start, pageSize, total, setPage }: { page: number; totalPages: number; start: number; pageSize: number; total: number; setPage: Dispatch<SetStateAction<number>> }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[var(--color-text-tertiary)]">显示 {start + 1}-{Math.min(start + pageSize, total)}，共 {total} 条</span>
      <Pagination><PaginationContent>
        <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="h-7 w-7 p-0"><ChevronLeft className="w-4 h-4" /></Button></PaginationItem>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((item) => (<PaginationItem key={item}><Button variant={page === item ? "default" : "outline"} size="sm" onClick={() => setPage(item)} className={cn("h-7 w-7 p-0 text-xs", page === item ? "bg-[var(--color-text-primary)] text-white" : "border-[var(--color-border-strong)] text-[var(--color-text-secondary)]")}>{item}</Button></PaginationItem>))}
        <PaginationItem><Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="h-7 w-7 p-0"><ChevronRight className="w-4 h-4" /></Button></PaginationItem>
      </PaginationContent></Pagination>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}
