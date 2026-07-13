import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ContainerEditor } from "@/components/edge-app/ContainerEditor";
import { VolumeEditor } from "@/components/edge-app/VolumeEditor";
import { emptyContainer, type ContainerForm, type VolumeForm } from "@/components/edge-app/container-model";

export interface DeploymentCreateForm {
  name: string;
  alias: string;
  description: string;
  namespace: string;
  replicas: number;
  containerName: string;
  image: string;
  imagePullPolicy: string;
  privileged: boolean;
  cpuLimit: string;
  memoryLimit: string;
  cpuRequest: string;
  memoryRequest: string;
  gpuEnabled: boolean;
  gpuResourceName: string;
  gpuCount: number;
  containers: ContainerForm[];
  initContainers: ContainerForm[];
  volumes: VolumeForm[];
  commandText: string;
  argsText: string;
  envText: string;
  postStartCommand: string;
  preStopCommand: string;
  livenessEnabled: boolean;
  livenessPath: string;
  livenessPort: number;
  readinessEnabled: boolean;
  readinessPath: string;
  readinessPort: number;
  startupEnabled: boolean;
  startupPath: string;
  startupPort: number;
  runAsUser: string;
  runAsNonRoot: boolean;
  readOnlyRootFilesystem: boolean;
  allowPrivilegeEscalation: boolean;
  port: number;
  hostPortEnabled: boolean;
  hostPort: number;
  hostNetwork: boolean;
  networkMode: "none" | "portMapping" | "hostNetwork";
  imagePullSecret: string;
  tolerationEnabled: boolean;
  tolerationKey: string;
  tolerationOperator: string;
  tolerationEffect: string;
  schedulingMode: string;
  targetNode: string;
  nodeSelectorKey: string;
  nodeSelectorValue: string;
  storageEnabled: boolean;
  volumeName: string;
  claimName: string;
  mountPath: string;
  subPath: string;
  readOnly: boolean;
  workloadLabelsText: string;
  podLabelsText: string;
  workloadAnnotationsText: string;
  podAnnotationsText: string;
  strategyType: "RollingUpdate" | "Recreate";
  maxUnavailable: string;
  maxSurge: string;
  revisionHistoryLimit: string;
  minReadySeconds: string;
  progressDeadlineSeconds: string;
  terminationGracePeriodSeconds: string;
}

interface Props {
  form: DeploymentCreateForm;
  onChange: (form: DeploymentCreateForm) => void;
  namespaces: Array<{ value: string; label: string }>;
  nodes: Array<{ name: string; role: string }>;
  mode: string;
  onModeChange: (mode: string) => void;
  yamlText: string;
  onYamlChange: (value: string) => void;
  error: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

const steps = ["基本信息", "容器配置", "高级配置"];

function OptionalBadge() {
  return <span className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--color-text-tertiary)]">选填</span>;
}

function PairEditor({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  const rows = useMemo(() => value.split("\n").filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return { key: separator > 0 ? line.slice(0, separator) : line, value: separator > 0 ? line.slice(separator + 1) : "" };
  }), [value]);
  const commit = (next: Array<{ key: string; value: string }>) => onChange(next.filter((row) => row.key || row.value).map((row) => `${row.key}=${row.value}`).join("\n"));
  return <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3"><Label className="pt-2 text-right">{title}</Label><div className="min-w-0 space-y-2">{rows.map((row, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] gap-2"><Input value={row.key} placeholder="键" onChange={(event) => commit(rows.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} /><Input value={row.value} placeholder="值" onChange={(event) => commit(rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} /><Button variant="ghost" size="icon" onClick={() => commit(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>)}<Button type="button" variant="ghost" size="sm" className="px-1 text-[var(--color-brand)] hover:bg-transparent" onClick={() => commit([...rows, { key: `key-${rows.length + 1}`, value: "value" }])}><Plus className="mr-1 h-4 w-4" />添加</Button></div></div>;
}

function FieldRow({ label, required = false, help, children }: { label: string; required?: boolean; help?: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3"><Label className="pt-2 text-right">{label}{required && <span className="ml-1 text-[var(--color-danger)]">*</span>}</Label><div className="min-w-0">{children}{help && <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">{help}</p>}</div></div>;
}

export function DeploymentCreateWizard(props: Props) {
  const [step, setStep] = useState(0);
  const { form, onChange } = props;
  const patch = <K extends keyof DeploymentCreateForm>(key: K, value: DeploymentCreateForm[K]) => onChange({ ...form, [key]: value });

  if (props.mode === "yaml") {
    return <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-soft)]"><header className="flex h-14 items-center justify-between border-b bg-white px-6"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={props.onCancel}><ArrowLeft className="h-5 w-5" /></Button><h2 className="text-lg font-semibold">YAML 创建部署</h2></div><Button variant="outline" onClick={() => props.onModeChange("form")}>切换到表单创建</Button></header><main className="min-h-0 flex-1 p-6"><Textarea value={props.yamlText} onChange={(event) => props.onYamlChange(event.target.value)} className="h-full min-h-[600px] resize-none bg-white font-mono text-xs" /></main><footer className="flex h-16 items-center justify-end gap-3 border-t bg-white px-6"><Button variant="ghost" onClick={props.onCancel}>取消</Button><Button onClick={props.onSubmit} disabled={!props.yamlText.trim() || props.submitting}>创建</Button></footer></div>;
  }

  return <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-soft)]">
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-6"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={props.onCancel}><ArrowLeft className="h-5 w-5" /></Button><h2 className="text-lg font-semibold">创建部署</h2></div><Button variant="outline" onClick={() => props.onModeChange("yaml")}>YAML 创建</Button></header>
    <div className="shrink-0 border-b bg-white px-6 py-5"><div className="mx-auto flex max-w-xl items-start">{steps.map((label, index) => <div key={label} className="flex flex-1 items-start last:flex-none"><div className="flex flex-col items-center gap-2"><div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${index < step ? "border border-[var(--color-brand)] text-[var(--color-brand)]" : index === step ? "bg-[var(--color-text-primary)] text-white" : "bg-[var(--color-border-strong)] text-[var(--color-text-tertiary)]"}`}>{index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</div><span className={`whitespace-nowrap text-xs ${index === step ? "text-[var(--color-brand)]" : "text-[var(--color-text-secondary)]"}`}>{label}</span></div>{index < 2 && <div className={`mx-3 mt-3 h-px flex-1 ${index < step ? "bg-[var(--color-brand)]" : "bg-[var(--color-border-strong)]"}`} />}</div>)}</div></div>
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      {props.error && <div className="mx-auto mb-4 max-w-6xl rounded-md border border-[#FFCCC7] bg-[#FFF2F0] px-4 py-3 text-sm text-[var(--color-danger)]">{props.error}</div>}
      {step === 0 && <section className="mx-auto min-h-[520px] max-w-6xl bg-white p-8 shadow-sm"><div className="grid max-w-3xl grid-cols-[140px_1fr] gap-x-5 gap-y-5"><Label className="pt-2 text-right">负载名称 *</Label><div><Input value={form.name} onChange={(event) => patch("name", event.target.value)} placeholder="最长 63 个字符，小写字母、数字或中划线" /><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">必须由小写字母、数字或中划线组成，并以字母或数字开头及结尾。</p></div><Label className="pt-2 text-right">负载别名<OptionalBadge /></Label><Input value={form.alias} onChange={(event) => patch("alias", event.target.value)} /><Label className="pt-2 text-right">命名空间 *</Label><Select value={form.namespace} onValueChange={(value) => patch("namespace", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{props.namespaces.filter((item) => item.value !== "all").map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Label className="pt-2 text-right">实例数 *</Label><Input type="number" min={1} value={form.replicas} onChange={(event) => patch("replicas", Number(event.target.value))} /><Label className="pt-2 text-right">描述<OptionalBadge /></Label><Textarea className="min-h-28" value={form.description} onChange={(event) => patch("description", event.target.value)} /></div></section>}
      {false && step === 1 && <section className="mx-auto max-w-6xl space-y-3">
        <div className="rounded-lg bg-white p-5 shadow-sm"><h3 className="mb-5 font-medium">基本信息</h3><div className="grid max-w-3xl grid-cols-[140px_1fr] gap-4"><Label className="pt-2 text-right">容器名称 *</Label><Input value={form.containerName} onChange={(event) => patch("containerName", event.target.value)} /><Label className="pt-2 text-right">容器镜像 *</Label><Input value={form.image} onChange={(event) => patch("image", event.target.value)} /><Label className="pt-2 text-right">镜像拉取策略</Label><Select value={form.imagePullPolicy} onValueChange={(value) => patch("imagePullPolicy", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IfNotPresent">IfNotPresent</SelectItem><SelectItem value="Always">Always</SelectItem><SelectItem value="Never">Never</SelectItem></SelectContent></Select><Label className="pt-2 text-right">镜像仓库 Secret</Label><Input value={form.imagePullSecret} onChange={(event) => patch("imagePullSecret", event.target.value)} placeholder="多个 Secret 使用英文逗号分隔" /><Label className="pt-2 text-right">特权容器</Label><label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={form.privileged} onChange={(event) => patch("privileged", event.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />启用</label></div><div className="mt-6 grid max-w-4xl grid-cols-[140px_1fr_1fr] gap-4"><Label className="pt-2 text-right">CPU 配额</Label><Input value={form.cpuRequest} onChange={(event) => patch("cpuRequest", event.target.value)} placeholder="请求值，如 50m" /><Input value={form.cpuLimit} onChange={(event) => patch("cpuLimit", event.target.value)} placeholder="限制值，如 100m" /><Label className="pt-2 text-right">内存配额</Label><Input value={form.memoryRequest} onChange={(event) => patch("memoryRequest", event.target.value)} placeholder="请求值，如 64Mi" /><Input value={form.memoryLimit} onChange={(event) => patch("memoryLimit", event.target.value)} placeholder="限制值，如 128Mi" /><Label className="pt-2 text-right">GPU 扩展资源</Label><label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={form.gpuEnabled} onChange={(event) => patch("gpuEnabled", event.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />启用 GPU</label><div />{form.gpuEnabled && <><Label className="pt-2 text-right">设备资源名称 *</Label><Input value={form.gpuResourceName} placeholder="如 nvidia.com/gpu" onChange={(event) => patch("gpuResourceName", event.target.value)} /><Input type="number" min={1} value={form.gpuCount} placeholder="数量" onChange={(event) => patch("gpuCount", Number(event.target.value))} /></>}</div>{form.gpuEnabled && <p className="ml-[140px] mt-2 text-xs text-[var(--color-text-tertiary)]">资源名称必须与集群设备插件上报的扩展资源一致，例如 nvidia.com/gpu。</p>}</div>
        <div className="rounded-lg bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-medium">初始化容器</h3><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">按顺序运行，可添加任意多个，配置能力与创建边缘应用一致。</p></div><Button type="button" variant="outline" size="sm" onClick={() => patch("initContainers", [...form.initContainers, emptyContainer(`init-${form.initContainers.length + 1}`, "busybox:latest")])}><Plus className="mr-1 h-4 w-4" />添加初始化容器</Button></div><div className="space-y-3">{form.initContainers.map((container, index) => <ContainerEditor key={container.id} title={`初始化容器 ${index + 1}`} isInit value={container} onChange={(next) => patch("initContainers", form.initContainers.map((item) => item.id === container.id ? next : item))} onRemove={() => patch("initContainers", form.initContainers.filter((item) => item.id !== container.id))} />)}</div></div>
        <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-medium">启动命令 <OptionalBadge /></summary><div className="mt-5 grid max-w-3xl grid-cols-[140px_1fr] gap-4"><Label className="pt-2 text-right">运行命令</Label><Textarea value={form.commandText} onChange={(event) => patch("commandText", event.target.value)} placeholder={'每行一个参数，例如：\n/bin/sh\n-c'} /><Label className="pt-2 text-right">运行参数</Label><Textarea value={form.argsText} onChange={(event) => patch("argsText", event.target.value)} placeholder={'每行一个参数，例如：\necho hello'} /></div></details>
        <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-medium">生命周期 <OptionalBadge /></summary><div className="mt-5 grid max-w-3xl grid-cols-[140px_1fr] gap-4"><Label className="pt-2 text-right">启动后命令</Label><Input value={form.postStartCommand} onChange={(event) => patch("postStartCommand", event.target.value)} placeholder="如 /bin/sh -c 'echo started'" /><Label className="pt-2 text-right">停止前命令</Label><Input value={form.preStopCommand} onChange={(event) => patch("preStopCommand", event.target.value)} placeholder="如 /bin/sh -c 'sleep 5'" /></div></details>
        <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-medium">健康检查 <OptionalBadge /></summary><div className="mt-5 space-y-5">{([ ["livenessEnabled", "livenessPath", "livenessPort", "容器存活检查"], ["readinessEnabled", "readinessPath", "readinessPort", "容器就绪检查"], ["startupEnabled", "startupPath", "startupPort", "容器启动检查"] ] as const).map(([enabledKey, pathKey, portKey, label]) => <div key={enabledKey} className="grid max-w-4xl grid-cols-[180px_1fr_180px] gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[enabledKey]} onChange={(event) => patch(enabledKey, event.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />{label}</label>{form[enabledKey] ? <><Input value={form[pathKey]} onChange={(event) => patch(pathKey, event.target.value)} placeholder="HTTP 路径" /><Input type="number" min={1} max={65535} value={form[portKey]} onChange={(event) => patch(portKey, Number(event.target.value))} placeholder="端口" /></> : <div className="col-span-2" />}</div>)}</div></details>
        <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-medium">环境变量 <OptionalBadge /></summary><div className="mt-5 max-w-3xl"><Textarea value={form.envText} onChange={(event) => patch("envText", event.target.value)} className="min-h-28 font-mono text-xs" placeholder={'每行 key=value，例如：\nNODE_ENV=production'} /></div></details>
        <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-medium">数据存储 <OptionalBadge /></summary><div className="mt-5 grid max-w-3xl grid-cols-[140px_1fr] gap-4"><Label className="pt-2 text-right">容器端口</Label><Input type="number" min={1} max={65535} value={form.port} onChange={(event) => patch("port", Number(event.target.value))} /><Label className="pt-2 text-right">挂载 PVC</Label><label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={form.storageEnabled} onChange={(event) => patch("storageEnabled", event.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />启用持久化存储</label>{form.storageEnabled && <><Label className="pt-2 text-right">PVC 名称 *</Label><Input value={form.claimName} onChange={(event) => patch("claimName", event.target.value)} /><Label className="pt-2 text-right">卷名称</Label><Input value={form.volumeName} onChange={(event) => patch("volumeName", event.target.value)} /><Label className="pt-2 text-right">挂载路径 *</Label><Input value={form.mountPath} onChange={(event) => patch("mountPath", event.target.value)} /><Label className="pt-2 text-right">子路径</Label><Input value={form.subPath} onChange={(event) => patch("subPath", event.target.value)} /></>}</div></details>
        <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-medium">安全设置 <OptionalBadge /></summary><div className="mt-5 grid max-w-3xl grid-cols-[140px_1fr] gap-4"><Label className="pt-2 text-right">运行用户 ID</Label><Input type="number" min={0} value={form.runAsUser} onChange={(event) => patch("runAsUser", event.target.value)} placeholder="如 1000" /><Label className="pt-2 text-right">安全选项</Label><div className="space-y-3 pt-2">{([ ["runAsNonRoot", "必须以非 root 用户运行"], ["readOnlyRootFilesystem", "只读根文件系统"], ["allowPrivilegeEscalation", "允许权限提升"] ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[key]} onChange={(event) => patch(key, event.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />{label}</label>)}</div></div></details>
      </section>}
      {step === 1 && <section className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm"><div><h3 className="font-medium">容器配置</h3><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">工作容器与初始化容器复用同一套资源、命令、环境变量、挂载和安全配置。</p></div><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => patch("initContainers", [...form.initContainers, emptyContainer(`init-${form.initContainers.length + 1}`, "busybox:latest")])}><Plus className="mr-1 h-4 w-4" />初始化容器</Button><Button type="button" onClick={() => patch("containers", [...form.containers, emptyContainer(`container-${form.containers.length + 1}`, "")])}><Plus className="mr-1 h-4 w-4" />工作容器</Button></div></div>
        <div className="rounded-lg bg-white p-4 shadow-sm"><Label>镜像仓库密钥</Label><Input className="mt-2 max-w-xl" value={form.imagePullSecret} onChange={(event) => patch("imagePullSecret", event.target.value)} placeholder="多个 Secret 使用逗号分隔" /></div>
        {form.containers.map((container, index) => <ContainerEditor key={container.id} title={`工作容器 ${index + 1}`} value={container} onChange={(next) => patch("containers", form.containers.map((item) => item.id === container.id ? next : item))} onRemove={form.containers.length > 1 ? () => patch("containers", form.containers.filter((item) => item.id !== container.id)) : undefined} />)}
        {form.initContainers.map((container, index) => <ContainerEditor key={container.id} title={`初始化容器 ${index + 1}`} isInit value={container} onChange={(next) => patch("initContainers", form.initContainers.map((item) => item.id === container.id ? next : item))} onRemove={() => patch("initContainers", form.initContainers.filter((item) => item.id !== container.id))} />)}
        <VolumeEditor values={form.volumes} onChange={(volumes) => patch("volumes", volumes)} />
      </section>}
      {step === 2 && <section className="mx-auto min-h-[540px] w-full min-w-0 bg-white shadow-sm"><Tabs defaultValue="scheduling" className="min-w-0 gap-0"><TabsList className="grid h-12 w-full grid-cols-4 rounded-none border-b border-[var(--color-brand)] bg-transparent p-0">{[["scheduling", "节点调度"], ["metadata", "标签与注解"], ["access", "访问配置"], ["upgrade", "升级策略"]].map(([value, label]) => <TabsTrigger key={value} value={value} className="h-12 min-w-0 rounded-t-md rounded-b-none px-1 text-xs data-[state=active]:border-[var(--color-brand)] data-[state=active]:border-b-white data-[state=active]:shadow-none">{label}</TabsTrigger>)}</TabsList><TabsContent value="scheduling" className="min-w-0 space-y-6 p-4"><FieldRow label="调度策略" required><div className="flex flex-wrap gap-x-4 gap-y-3 pt-2">{[["auto", "自动调度"], ["nodeName", "指定节点"], ["nodeSelector", "节点亲和性"]].map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" checked={form.schedulingMode === value} onChange={() => patch("schedulingMode", value)} className="h-4 w-4 accent-[var(--color-brand)]" />{label}</label>)}</div></FieldRow>{form.schedulingMode === "nodeName" && <FieldRow label="调度对象" required><Select value={form.targetNode || "__none__"} onValueChange={(value) => patch("targetNode", value === "__none__" ? "" : value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">请选择节点</SelectItem>{props.nodes.map((node) => <SelectItem key={node.name} value={node.name}>{node.name} ({node.role})</SelectItem>)}</SelectContent></Select></FieldRow>}{form.schedulingMode === "nodeSelector" && <><FieldRow label="标签键" required><Input value={form.nodeSelectorKey} onChange={(event) => patch("nodeSelectorKey", event.target.value)} /></FieldRow><FieldRow label="标签值" required><Input value={form.nodeSelectorValue} onChange={(event) => patch("nodeSelectorValue", event.target.value)} /></FieldRow></>}<FieldRow label="容忍配置"><label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={form.tolerationEnabled} onChange={(event) => patch("tolerationEnabled", event.target.checked)} className="h-4 w-4 accent-[var(--color-brand)]" />添加容忍</label></FieldRow>{form.tolerationEnabled && <div className="ml-[132px] grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3"><Input value={form.tolerationKey} onChange={(event) => patch("tolerationKey", event.target.value)} placeholder="污点键" /><Select value={form.tolerationOperator} onValueChange={(value) => patch("tolerationOperator", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Exists">Exists</SelectItem></SelectContent></Select><Select value={form.tolerationEffect} onValueChange={(value) => patch("tolerationEffect", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NoSchedule">NoSchedule</SelectItem><SelectItem value="PreferNoSchedule">PreferNoSchedule</SelectItem><SelectItem value="NoExecute">NoExecute</SelectItem></SelectContent></Select></div>}</TabsContent><TabsContent value="metadata" className="min-w-0 space-y-8 p-4"><div className="space-y-4"><h3 className="font-medium">标签</h3><PairEditor title="工作负载标签" value={form.workloadLabelsText} onChange={(value) => patch("workloadLabelsText", value)} /><PairEditor title="容器组标签" value={form.podLabelsText} onChange={(value) => patch("podLabelsText", value)} /></div><div className="space-y-4"><h3 className="font-medium">注解</h3><PairEditor title="工作负载注解" value={form.workloadAnnotationsText} onChange={(value) => patch("workloadAnnotationsText", value)} /><PairEditor title="容器组注解" value={form.podAnnotationsText} onChange={(value) => patch("podAnnotationsText", value)} /></div></TabsContent><TabsContent value="access" className="min-w-0 p-4"><FieldRow label="网络类型"><div className="space-y-4">{[["none", "不可访问", "工作负载不可从主机端口访问"], ["portMapping", "端口映射", "将主机端口映射到对应容器端口"], ["hostNetwork", "主机网络", "容器直接使用节点网络，与主机共享 IP"]].map(([value, label, help]) => <label key={value} className="flex items-start gap-2"><input type="radio" checked={form.networkMode === value} onChange={() => onChange({ ...form, networkMode: value as DeploymentCreateForm["networkMode"], hostNetwork: value === "hostNetwork", hostPortEnabled: value === "portMapping" })} className="mt-1 h-4 w-4 accent-[var(--color-brand)]" /><span><span className="text-sm">{label}</span><span className="block text-xs text-[var(--color-text-tertiary)]">{help}</span></span></label>)}</div></FieldRow>{form.networkMode === "portMapping" && <div className="mt-5"><FieldRow label="主机端口" required><Input type="number" min={1} max={65535} value={form.hostPort} onChange={(event) => patch("hostPort", Number(event.target.value))} /></FieldRow></div>}</TabsContent><TabsContent value="upgrade" className="min-w-0 space-y-5 p-4"><FieldRow label="升级方式"><Select value={form.strategyType} onValueChange={(value: DeploymentCreateForm["strategyType"]) => patch("strategyType", value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="RollingUpdate">滚动升级 (RollingUpdate)</SelectItem><SelectItem value="Recreate">重新创建 (Recreate)</SelectItem></SelectContent></Select></FieldRow>{form.strategyType === "RollingUpdate" && <><FieldRow label="最大无效 Pod 数" required><Input value={form.maxUnavailable} onChange={(event) => patch("maxUnavailable", event.target.value)} placeholder="如 25% 或 1" /></FieldRow><FieldRow label="最大浪涌" required><Input value={form.maxSurge} onChange={(event) => patch("maxSurge", event.target.value)} placeholder="如 25% 或 1" /></FieldRow></>}<FieldRow label="最大保留版本数"><Input type="number" min={0} value={form.revisionHistoryLimit} onChange={(event) => patch("revisionHistoryLimit", event.target.value)} /></FieldRow><FieldRow label="Pod 可用最短时间"><Input type="number" min={0} value={form.minReadySeconds} onChange={(event) => patch("minReadySeconds", event.target.value)} /></FieldRow><FieldRow label="升级最大持续时间"><Input type="number" min={0} value={form.progressDeadlineSeconds} onChange={(event) => patch("progressDeadlineSeconds", event.target.value)} /></FieldRow><FieldRow label="缩容时间窗"><Input type="number" min={0} max={9999} value={form.terminationGracePeriodSeconds} onChange={(event) => patch("terminationGracePeriodSeconds", event.target.value)} /></FieldRow></TabsContent></Tabs></section>}
    </main>
    <footer className="flex h-16 shrink-0 items-center justify-end gap-3 border-t bg-white px-6"><Button variant="ghost" onClick={props.onCancel}>取消</Button>{step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="mr-1 h-4 w-4" />上一步</Button>}{step < 2 ? <Button onClick={() => setStep(step + 1)} disabled={!form.name.trim()}>{step === 0 ? "下一步" : "下一步"}<ChevronRight className="ml-1 h-4 w-4" /></Button> : <Button onClick={props.onSubmit} disabled={!form.name.trim() || !form.containers.length || form.containers.some((container) => !container.name.trim() || !container.image.trim()) || props.submitting}>创建</Button>}</footer>
  </div>;
}
