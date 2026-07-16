import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Copy,
  FileCode2,
  HelpCircle,
  Pencil,
  Plus,
  RotateCcw,
  Server,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toAccessConfigUiModel, type AccessConfigUiModel } from "@/api/adapters/access-config.adapter";
import { getAccessConfig, updateAccessConfig } from "@/api/services/product";
import { listNodes } from "@/api/services/resources";
import type { EdgeNodeView } from "@/types/kubeedge";
import { cn } from "@/lib/utils";
import { RequiredFieldError, useRequiredFieldValidation } from "@/hooks/useRequiredFieldValidation";

type DetailTab = "nodes" | "labels" | "yaml";

type EditForm = {
  driver: "systemd" | "cgroups";
  criAddress: string;
  address: string;
  protocol: "websocket" | "QUIC";
  registry: string;
  description: string;
  labels: Array<{ key: string; value: string }>;
};

function toEditForm(config: AccessConfigUiModel): EditForm {
  return {
    driver: config.driver || "systemd",
    criAddress: config.criAddress || "",
    address: config.cloudCoreAddress || "",
    protocol: config.protocol.toLowerCase() === "quic" ? "QUIC" : "websocket",
    registry: config.registry || "",
    description: config.description || "",
    labels: Object.entries(config.labels).map(([key, value]) => ({ key, value })).concat(Object.keys(config.labels).length ? [] : [{ key: "", value: "" }]),
  };
}

function runtimeName(config: AccessConfigUiModel) {
  if (config.criAddress.toLowerCase().includes("containerd")) return "containerd";
  if (config.criAddress.toLowerCase().includes("crio")) return "CRI-O";
  return "docker";
}

function yamlFor(config: AccessConfigUiModel) {
  const labelLines = Object.entries(config.labels).map(([key, value]) => `    ${key}: "${value}"`).join("\n");
  return `apiVersion: v1
kind: NodeAccessConfig
metadata:
  name: ${config.name}${labelLines ? `\n  labels:\n${labelLines}` : ""}
spec:
  driver: ${config.driver || "systemd"}
  accessAddress: ${config.cloudCoreAddress || "-"}
  protocol: ${config.protocol || "websocket"}
  imageRepo: ${config.registry || "-"}
  kubeEdgeVersion: ${config.kubeEdgeVersion || "-"}
  runtime: ${runtimeName(config)}
  description: ${config.description || "-"}`;
}

export function AccessConfigDetailPage() {
  const navigate = useNavigate();
  const { name = "" } = useParams();
  const formValidation = useRequiredFieldValidation<"criAddress" | "address" | "registry">();
  const [config, setConfig] = useState<AccessConfigUiModel | null>(null);
  const [nodes, setNodes] = useState<EdgeNodeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<DetailTab>("nodes");
  const [editOpen, setEditOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getAccessConfig(name), listNodes().catch(() => [])])
      .then(([detail, nodeItems]) => {
        if (!active) return;
        setConfig(toAccessConfigUiModel(detail.item));
        setNodes(nodeItems);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "接入配置加载失败"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [name]);

  const attachedNodes = useMemo(() => {
    if (!config) return [];
    const rules = Object.entries(config.labels);
    return nodes.filter((node) => {
      if (config.nodeName && node.name === config.nodeName) return true;
      if (!rules.length) return false;
      const labels = node.raw.metadata?.labels || {};
      return rules.every(([key, value]) => labels[key] === value);
    });
  }, [config, nodes]);

  const counts = useMemo(() => ({
    total: attachedNodes.length,
    online: attachedNodes.filter((node) => node.status === "Ready").length,
    abnormal: attachedNodes.filter((node) => node.status === "NotReady").length,
    unknown: attachedNodes.filter((node) => node.status === "Unknown").length,
  }), [attachedNodes]);

  const openEdit = () => {
    if (!config) return;
    setForm(toEditForm(config));
    setError("");
    formValidation.resetErrors();
    setEditOpen(true);
  };

  const save = async () => {
    if (!config || !form) return;
    if (!formValidation.validate([
      { field: "criAddress", valid: Boolean(form.criAddress.trim()), message: "请输入 CRI 服务地址", elementId: "access-config-cri-address" },
      { field: "address", valid: Boolean(form.address.trim()), message: "请输入访问地址", elementId: "access-config-address" },
      { field: "registry", valid: Boolean(form.registry.trim()), message: "请输入镜像仓库", elementId: "access-config-registry" },
    ])) return;
    setSaving(true);
    setError("");
    try {
      const labels = Object.fromEntries(form.labels.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value.trim()]));
      const result = await updateAccessConfig(config.name, {
        edgeUnitRef: config.edgeUnitRef,
        nodeName: config.nodeName,
        architecture: config.architecture,
        os: config.os,
        kubeEdgeVersion: config.kubeEdgeVersion,
        cloudCoreAddress: form.address.trim(),
        protocol: form.protocol,
        driver: form.driver,
        criAddress: form.criAddress.trim(),
        registry: form.registry.trim(),
        description: form.description.trim(),
        labels,
      });
      setConfig(toAccessConfigUiModel(result.item));
      setEditOpen(false);
      setForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "接入配置保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="blueedge-page"><div className="blueedge-empty-state min-h-[420px]"><span className="blueedge-empty-state-icon" /><span>正在加载接入配置...</span></div></div>;
  }

  if (!config) {
    return (
      <div className="blueedge-page space-y-5">
        <Button variant="outline" className="h-10 rounded-xl" onClick={() => navigate("/nodes?tab=access")}><ArrowLeft className="h-4 w-4" />返回</Button>
        <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{error || "未找到接入配置"}</div>
      </div>
    );
  }

  const yaml = yamlFor(config);

  return (
    <div className="blueedge-page space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" className="action-button shrink-0" onClick={() => navigate("/nodes?tab=access")} aria-label="返回接入配置列表"><ArrowLeft className="h-4 w-4" /></button>
          <div className="min-w-0">
            <div className="mb-0.5 flex flex-wrap items-center gap-3">
              <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">{config.name}</h1>
              <span className="rounded-full bg-[#e0f2fe] px-2 py-0.5 text-xs font-medium text-[#1687d9]">{config.driver || "systemd"}</span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">{config.protocol || "-"} · {config.cloudCoreAddress || "-"} · 创建于 {config.createdAt}</p>
          </div>
        </div>
        <Button className="blueedge-primary-button h-9 rounded-[10px] px-3.5 text-xs" onClick={openEdit}><Pencil className="h-[13px] w-[13px]" />编辑</Button>
      </div>

      {error && <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{error}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Server />} value={counts.total} label="边缘节点" tone="blue" />
        <MetricCard icon={<CheckCircle2 />} value={counts.online} label="在线" tone="green" />
        <MetricCard icon={<AlertTriangle />} value={counts.abnormal} label="异常" tone="red" />
        <MetricCard icon={<HelpCircle />} value={counts.unknown} label="未知" tone="gray" />
      </div>

      <section className="rounded-2xl border border-[var(--color-border)] bg-white px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
        <h2 className="mb-5 text-sm font-semibold text-[var(--color-text-primary)]">基本信息</h2>
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
          <DetailInfo label="配置名称" value={config.name} />
          <DetailInfo label="驱动方式" value={config.driver || "systemd"} />
          <DetailInfo label="通信协议" value={config.protocol || "-"} />
          <DetailInfo label="访问地址" value={config.cloudCoreAddress || "-"} />
          <DetailInfo label="KubeEdge 版本" value={config.kubeEdgeVersion || "-"} />
          <DetailInfo label="镜像仓库" value={config.registry || "-"} />
          <DetailInfo label="容器运行时" value={runtimeName(config)} />
          <DetailInfo label="创建时间" value={config.createdAt} />
        </div>
        {config.description && <div className="mt-5 border-t border-[var(--color-border)] pt-5"><DetailInfo label="描述" value={config.description} /></div>}
      </section>

      <div className="flex flex-wrap gap-2.5">
        <DetailTabButton active={activeTab === "nodes"} onClick={() => setActiveTab("nodes")} icon={<Server />} label={`接入节点 (${counts.total})`} />
        <DetailTabButton active={activeTab === "labels"} onClick={() => setActiveTab("labels")} icon={<Tag />} label="标签" />
        <DetailTabButton active={activeTab === "yaml"} onClick={() => setActiveTab("yaml")} icon={<FileCode2 />} label="YAML" />
      </div>

      {activeTab === "nodes" && (
        <section className="table-card overflow-hidden">
          <Table className="table-fixed">
            <TableHeader><TableRow className="h-12 bg-white hover:bg-white">
              <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">节点名称</TableHead>
              <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">IP 地址</TableHead>
              <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">状态</TableHead>
              <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">操作系统</TableHead>
              <TableHead className="px-5 text-xs text-[var(--color-text-tertiary)]">接入时间</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {attachedNodes.length ? attachedNodes.map((node) => (
                <TableRow key={node.name} className="h-[69px]">
                  <TableCell className="px-4 text-sm font-medium text-[var(--color-brand)]">{node.name}</TableCell>
                  <TableCell className="px-4 font-mono text-xs text-[var(--color-text-secondary)]">{node.internalIP || "-"}</TableCell>
                  <TableCell className="px-5"><NodeStatus status={node.status} /></TableCell>
                  <TableCell className="px-4 text-xs text-[var(--color-text-primary)]">{node.osImage || "-"}</TableCell>
                  <TableCell className="px-4 text-xs text-[var(--color-text-tertiary)]">{node.createdAt || "-"}</TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={5}><div className="blueedge-empty-state min-h-36"><span className="blueedge-empty-state-icon" /><span>暂无接入节点</span></div></TableCell></TableRow>}
            </TableBody>
          </Table>
        </section>
      )}

      {activeTab === "labels" && (
        <section className="rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-semibold">节点标签</h2><Button className="blueedge-primary-button h-[30px] rounded-lg px-3 text-xs" onClick={openEdit}><Pencil className="h-3 w-3" />修改标签</Button></div>
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(config.labels).map(([key, value]) => <div key={key} className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3"><Tag className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" /><span className="text-sm font-medium">{key}</span><span className="text-[var(--color-text-tertiary)]">=</span><span className="text-sm text-[var(--color-text-secondary)]">{value}</span></div>)}
          </div>
          {!Object.keys(config.labels).length && <div className="blueedge-empty-state min-h-32"><span className="blueedge-empty-state-icon" /><span>暂无标签</span></div>}
        </section>
      )}

      {activeTab === "yaml" && (
        <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4 py-2"><span className="text-xs font-medium text-[var(--color-text-secondary)]">YAML 预览</span><Button variant="ghost" className="h-7 rounded-lg px-2 text-xs text-[var(--color-brand)]" onClick={async () => { await navigator.clipboard.writeText(yaml); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}><Copy className="h-3 w-3" />{copied ? "已复制" : "复制"}</Button></div>
          <pre className="max-h-[calc(100vh-380px)] overflow-auto bg-[#1f1f1f] p-4 font-mono text-xs leading-5 text-[#d1d5db]">{yaml}</pre>
        </section>
      )}

      <Dialog open={editOpen} onOpenChange={(open) => { if (open) setEditOpen(true); else setCancelConfirmOpen(true); }}>
        <DialogContent showCloseButton={false} className="!flex max-h-[700px] w-[min(600px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] p-0">
          <DialogHeader className="flex h-16 shrink-0 flex-row items-center justify-between border-b border-[var(--color-border)] px-7 py-0">
            <DialogTitle className="text-lg font-semibold">编辑接入配置</DialogTitle>
            <button type="button" onClick={() => setCancelConfirmOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"><X className="h-5 w-5" /></button>
          </DialogHeader>
          {form && <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-6">
            <EditField label="配置名称" required><Input value={config.name} readOnly className="h-11 rounded-xl bg-white" /></EditField>
            <EditField label="驱动方式" required><Segmented value={form.driver} values={["systemd", "cgroups"]} onChange={(value) => setForm({ ...form, driver: value as EditForm["driver"] })} /></EditField>
            <EditField label="CRI 服务地址" required><Input id="access-config-cri-address" value={form.criAddress} onChange={(event) => { setForm({ ...form, criAddress: event.target.value }); formValidation.clearError("criAddress"); }} aria-invalid={Boolean(formValidation.errors.criAddress)} className="h-11 rounded-xl" /><RequiredFieldError id="access-config-cri-address-error" message={formValidation.errors.criAddress} /></EditField>
            <EditField label="访问地址" required><Input id="access-config-address" value={form.address} onChange={(event) => { setForm({ ...form, address: event.target.value }); formValidation.clearError("address"); }} aria-invalid={Boolean(formValidation.errors.address)} className="h-11 rounded-xl" /><RequiredFieldError id="access-config-address-error" message={formValidation.errors.address} /></EditField>
            <EditField label="通信协议" required><Segmented value={form.protocol} values={["websocket", "QUIC"]} labels={["WebSocket", "QUIC"]} onChange={(value) => setForm({ ...form, protocol: value as EditForm["protocol"] })} /></EditField>
            <EditField label="镜像仓库" required>
              <Input id="access-config-registry" value={form.registry} onChange={(event) => { setForm({ ...form, registry: event.target.value }); formValidation.clearError("registry"); }} aria-invalid={Boolean(formValidation.errors.registry)} className="h-11 rounded-xl" />
              <RequiredFieldError id="access-config-registry-error" message={formValidation.errors.registry} />
              <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" className="h-9 rounded-xl" onClick={() => setForm({ ...form, registry: config.cloudCoreAddress || form.registry })}><Cloud className="h-4 w-4" />引用云端地址</Button><Button type="button" variant="outline" className="h-9 rounded-xl" onClick={() => setForm({ ...form, registry: "registry.cn-beijing.aliyuncs.com/kubeedge" })}><RotateCcw className="h-4 w-4" />一键填充默认仓库</Button></div>
              <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4 text-sm text-[var(--color-text-secondary)]"><p className="flex items-center gap-2 font-semibold text-[var(--color-text-primary)]"><HelpCircle className="h-4 w-4 text-[#f59e0b]" />镜像仓库说明</p><p className="mt-2">用于拉取边端组件，建议使用边缘节点可稳定访问的企业仓库。</p></div>
            </EditField>
            <EditField label="描述"><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="min-h-24 rounded-xl" /></EditField>
            <EditField label="标签">
              <div className="space-y-3">{form.labels.map((label, index) => <div key={index} className="grid grid-cols-[1fr_1fr_40px] gap-3"><Input value={label.key} placeholder="键" onChange={(event) => setForm({ ...form, labels: form.labels.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item) })} className="h-10 rounded-xl" /><Input value={label.value} placeholder="值" onChange={(event) => setForm({ ...form, labels: form.labels.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })} className="h-10 rounded-xl" /><button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]" onClick={() => setForm({ ...form, labels: form.labels.length > 1 ? form.labels.filter((_, itemIndex) => itemIndex !== index) : [{ key: "", value: "" }] })}><Trash2 className="h-4 w-4" /></button></div>)}</div>
              <button type="button" onClick={() => setForm({ ...form, labels: [...form.labels, { key: "", value: "" }] })} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-brand)]"><Plus className="h-4 w-4" />添加标签</button>
            </EditField>
            {error && <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{error}</div>}
          </div>}
          <DialogFooter className="h-16 shrink-0 border-t border-[var(--color-border)] px-7 py-3"><Button variant="outline" className="h-10 rounded-xl px-6" onClick={() => setCancelConfirmOpen(true)}>取消</Button><Button className="h-10 rounded-xl px-6" onClick={() => void save()} disabled={saving}>{saving ? "保存中..." : "保存"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent className="z-[120] w-[min(480px,calc(100vw-32px))] max-w-none gap-0 overflow-hidden rounded-[20px] p-0">
          <AlertDialogHeader className="flex h-16 flex-row items-center justify-between space-y-0 border-b border-[var(--color-border)] px-7 py-0">
            <AlertDialogTitle className="flex items-center gap-3 text-base font-semibold text-[var(--color-text-primary)]">
              <AlertTriangle className="h-5 w-5 text-[var(--color-danger)]" />
              确认取消编辑
            </AlertDialogTitle>
            <button
              type="button"
              aria-label="关闭取消确认框"
              onClick={() => setCancelConfirmOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]"
            >
              <X className="h-4 w-4" />
            </button>
          </AlertDialogHeader>
          <AlertDialogDescription className="flex min-h-[84px] items-center px-7 py-5 text-sm leading-6 text-[var(--color-text-secondary)]">
            取消后，当前编辑内容将不会保存。
          </AlertDialogDescription>
          <AlertDialogFooter className="flex h-[76px] items-center justify-end gap-3 border-t border-[var(--color-border)] px-7 py-0 sm:space-x-0">
            <AlertDialogCancel className="mt-0 h-10 rounded-xl border-[var(--color-border)] px-6 text-sm font-semibold">取消</AlertDialogCancel>
            <AlertDialogAction
              className="h-10 rounded-xl bg-[var(--color-danger)] px-6 text-sm font-semibold text-white hover:bg-[var(--color-danger)]/90"
              onClick={() => { setCancelConfirmOpen(false); setEditOpen(false); setForm(null); }}
            >
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MetricCard({ icon, value, label, tone }: { icon: React.ReactElement; value: number; label: string; tone: "blue" | "green" | "red" | "gray" }) {
  const styles = { blue: "bg-[#e0f2fe] text-[#1687d9]", green: "bg-[#dcfce7] text-[#18b968]", red: "bg-[#fee2e2] text-[#ff4d4f]", gray: "bg-[#f3f4f6] text-[#9ca3af]" };
  return <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-white p-4"><span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]", styles[tone])}>{icon}</span><div><p className={cn("text-xl font-bold leading-[1.2]", tone === "red" ? "text-[#ff4d4f]" : tone === "gray" ? "text-[#9ca3af]" : tone === "green" ? "text-[#18b968]" : "text-[#1687d9]")}>{value}</p><p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{label}</p></div></div>;
}

function DetailInfo({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="mb-1 text-xs text-[var(--color-text-tertiary)]">{label}</p><p className="truncate text-sm font-medium text-[var(--color-text-primary)]" title={value}>{value}</p></div>;
}

function DetailTabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactElement; label: string }) {
  return <button type="button" onClick={onClick} className={cn(active ? "btn-tab-active" : "btn-tab", "[&>svg]:h-3.5 [&>svg]:w-3.5")}>{icon}{label}</button>;
}

function NodeStatus({ status }: { status: EdgeNodeView["status"] }) {
  const ready = status === "Ready";
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", ready ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : status === "NotReady" ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "bg-[var(--color-bg-soft)] text-[var(--color-text-tertiary)]")}><span className="h-1.5 w-1.5 rounded-full bg-current" />{ready ? "健康" : status === "NotReady" ? "异常" : "未知"}</span>;
}

function EditField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div><label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">{label}{required && <span className="ml-1 text-[var(--color-danger)]">*</span>}</label>{children}</div>;
}

function Segmented({ value, values, labels, onChange }: { value: string; values: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return <div className="grid grid-cols-2 gap-3">{values.map((item, index) => <button key={item} type="button" onClick={() => onChange(item)} className={cn("h-11 rounded-xl border-2 text-sm font-semibold", value === item ? "border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-white" : "border-[var(--color-input-border)] bg-white text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)]")}>{labels?.[index] || item}</button>)}</div>;
}
