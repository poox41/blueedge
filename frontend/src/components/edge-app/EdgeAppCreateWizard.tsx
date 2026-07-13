import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ContainerEditor } from "./ContainerEditor";
import { VolumeEditor } from "./VolumeEditor";
import { emptyContainer } from "./container-model";
import type { EdgeApplicationForm } from "./container-model";

interface Props {
  form: EdgeApplicationForm;
  onFormChange: (form: EdgeApplicationForm) => void;
  namespaces: Array<{ value: string; label: string }>;
  nodeGroups: string[];
  mode: string;
  onModeChange: (mode: string) => void;
  yamlText: string;
  onYamlChange: (value: string) => void;
  generatedYaml: string;
  error: string;
  submitting: boolean;
  canSubmit: boolean;
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

  return (
    <div className="grid grid-cols-[160px_minmax(0,520px)] items-start gap-4">
      <Label className="pt-2 text-right text-sm text-[var(--color-text-secondary)]">{title}</Label>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_36px] gap-2">
            <Input value={row.key} placeholder="键" onChange={(event) => commit(rows.map((item, i) => i === index ? { key: event.target.value, value: item.value } : item))} />
            <Input value={row.value} placeholder="值" onChange={(event) => commit(rows.map((item, i) => i === index ? { key: item.key, value: event.target.value } : item))} />
            <Button type="button" variant="ghost" size="icon" className="text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)]" onClick={() => commit(rows.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" className="h-8 px-1 text-[var(--color-brand)] hover:bg-transparent hover:text-[var(--color-brand)]" onClick={() => commit([...rows, { key: `key-${rows.length + 1}`, value: "value" }])}><Plus className="mr-1 h-4 w-4" />添加</Button>
      </div>
    </div>
  );
}

function NumberWithUnit({ value, unit, onChange }: { value: string; unit: string; onChange: (value: string) => void }) {
  return (
    <div className="flex max-w-60">
      <Input type="number" min={0} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-r-none" />
      <span className="flex min-w-11 items-center justify-center rounded-r-md border border-l-0 border-input bg-[var(--color-bg-soft)] px-3 text-sm text-[var(--color-text-tertiary)]">{unit}</span>
    </div>
  );
}

function IntOrPercentInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isPercent = value.endsWith("%");
  const number = isPercent ? value.slice(0, -1) : value;
  return (
    <div className="flex max-w-60">
      <Input type="number" min={0} value={number} onChange={(event) => onChange(`${event.target.value}${isPercent ? "%" : ""}`)} className="rounded-r-none" />
      <Select value={isPercent ? "percent" : "count"} onValueChange={(unit) => onChange(`${number}${unit === "percent" ? "%" : ""}`)}>
        <SelectTrigger className="w-16 rounded-l-none bg-[var(--color-bg-soft)]"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="percent">%</SelectItem><SelectItem value="count">个</SelectItem></SelectContent>
      </Select>
    </div>
  );
}

function UpgradeRow({ label, required = false, help, children }: { label: string; required?: boolean; help?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,520px)] gap-4">
      <Label className="pt-2 text-right text-sm text-[var(--color-text-secondary)]">{label}{required && <span className="ml-1 text-[var(--color-danger)]">*</span>}</Label>
      <div>{children}{help && <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">{help}</p>}</div>
    </div>
  );
}

export function EdgeAppCreateWizard(props: Props) {
  const [step, setStep] = useState(0);
  const { form, onFormChange: change } = props;
  const patch = <K extends keyof EdgeApplicationForm>(key: K, value: EdgeApplicationForm[K]) => change({ ...form, [key]: value });

  if (props.mode === "yaml") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-soft)]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-6"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={props.onCancel}><ArrowLeft className="h-5 w-5" /></Button><h2 className="text-lg font-semibold">YAML 创建边缘应用</h2></div><Button variant="outline" size="sm" onClick={() => props.onModeChange("form")}>切换到表单创建</Button></header>
        <main className="min-h-0 flex-1 p-6"><Textarea value={props.yamlText} onChange={(event) => props.onYamlChange(event.target.value)} className="h-full min-h-[600px] resize-none bg-white font-mono text-xs" /></main>
        <footer className="flex h-16 shrink-0 items-center justify-end gap-3 border-t bg-white px-6"><Button variant="ghost" onClick={props.onCancel}>取消</Button><Button onClick={props.onSubmit} disabled={!props.yamlText.trim() || props.submitting}>确认创建</Button></footer>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg-soft)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white px-6"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={props.onCancel}><ArrowLeft className="h-5 w-5" /></Button><h2 className="text-lg font-semibold">创建边缘应用</h2></div><Button variant="outline" size="sm" onClick={() => props.onModeChange("yaml")}>YAML 创建</Button></header>
      <div className="shrink-0 border-b bg-white px-6 py-5">
        <div className="mx-auto flex max-w-xl items-start">
          {steps.map((label, index) => (
            <div key={label} className="flex flex-1 items-start last:flex-none">
              <div className="flex flex-col items-center gap-2"><div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${index < step ? "border border-[var(--color-brand)] bg-white text-[var(--color-brand)]" : index === step ? "bg-[var(--color-text-primary)] text-white" : "bg-[var(--color-border-strong)] text-[var(--color-text-tertiary)]"}`}>{index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</div><span className={`whitespace-nowrap text-xs ${index === step ? "text-[var(--color-brand)]" : "text-[var(--color-text-secondary)]"}`}>{label}</span></div>
              {index < steps.length - 1 && <div className={`mx-3 mt-3 h-px flex-1 ${index < step ? "bg-[var(--color-brand)]" : "bg-[var(--color-border-strong)]"}`} />}
            </div>
          ))}
        </div>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {props.error && <div className="mx-auto mb-4 max-w-6xl rounded-md border border-[#FFCCC7] bg-[#FFF2F0] px-4 py-3 text-sm text-[var(--color-danger)]">{props.error}</div>}

        {step === 0 && (
          <section className="mx-auto max-w-3xl rounded-lg bg-white p-8 shadow-sm">
            <div className="grid grid-cols-[140px_1fr] gap-x-5 gap-y-5">
              <Label className="pt-2 text-right">负载名称 *</Label><div><Input value={form.name} onChange={(event) => patch("name", event.target.value)} placeholder="最长 63 个字符，小写字母、数字或中划线" /><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">用于 EdgeApplication 和内部工作负载 metadata.name。</p></div>
              <Label className="pt-2 text-right">负载别名<OptionalBadge /></Label><Input value={form.alias} onChange={(event) => patch("alias", event.target.value)} />
              <Label className="pt-2 text-right">工作负载类型 *</Label><Select value={form.type} onValueChange={(value) => patch("type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Deployment">Deployment</SelectItem><SelectItem value="DaemonSet">DaemonSet</SelectItem><SelectItem value="Job">Job</SelectItem><SelectItem value="Pod">Pod</SelectItem></SelectContent></Select>
              <Label className="pt-2 text-right">命名空间 *</Label><Select value={form.namespace} onValueChange={(value) => patch("namespace", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{props.namespaces.filter((item) => item.value !== "all").map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
              {form.type === "Deployment" && <><Label className="pt-2 text-right">实例数 *</Label><Input type="number" min={1} value={form.replicas} onChange={(event) => patch("replicas", Number(event.target.value))} /></>}
              <Label className="pt-2 text-right">目标节点组 *</Label><Select value={form.targetNodeGroup} onValueChange={(value) => patch("targetNodeGroup", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{props.nodeGroups.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>
              <Label className="pt-2 text-right">描述<OptionalBadge /></Label><Textarea value={form.description} onChange={(event) => patch("description", event.target.value)} className="min-h-28" />
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="mx-auto max-w-6xl space-y-5">
            <div className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm"><div><h3 className="font-medium">容器配置</h3><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">工作容器与初始化容器复用同一套资源、命令、环境变量、挂载和安全配置。</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => patch("initContainers", [...form.initContainers, emptyContainer(`init-${form.initContainers.length + 1}`, "busybox:latest")])}><Plus className="mr-1 h-4 w-4" />初始化容器</Button><Button onClick={() => patch("containers", [...form.containers, emptyContainer(`container-${form.containers.length + 1}`, "")])}><Plus className="mr-1 h-4 w-4" />工作容器</Button></div></div>
            <div className="rounded-lg bg-white p-4 shadow-sm"><Label>镜像仓库密钥</Label><Input className="mt-2 max-w-xl" value={form.imagePullSecrets} onChange={(event) => patch("imagePullSecrets", event.target.value)} placeholder="多个 Secret 使用逗号分隔" /></div>
            {form.containers.map((container, index) => <ContainerEditor key={container.id} title={`工作容器 ${index + 1}`} value={container} onChange={(next) => patch("containers", form.containers.map((item) => item.id === container.id ? next : item))} onRemove={form.containers.length > 1 ? () => patch("containers", form.containers.filter((item) => item.id !== container.id)) : undefined} />)}
            {form.initContainers.map((container, index) => <ContainerEditor key={container.id} title={`初始化容器 ${index + 1}`} isInit value={container} onChange={(next) => patch("initContainers", form.initContainers.map((item) => item.id === container.id ? next : item))} onRemove={() => patch("initContainers", form.initContainers.filter((item) => item.id !== container.id))} />)}
            <VolumeEditor values={form.volumes} onChange={(volumes) => patch("volumes", volumes)} />
          </section>
        )}

        {step === 2 && (
          <section className="mx-auto min-h-[540px] max-w-6xl bg-white shadow-sm">
            <Tabs defaultValue="metadata" className="gap-0">
              <TabsList className="h-12 w-full justify-start rounded-none border-b border-[var(--color-brand)] bg-transparent p-0">
                <TabsTrigger value="metadata" className="h-12 flex-none rounded-t-md rounded-b-none px-8 text-[var(--color-text-secondary)] data-[state=active]:border-[var(--color-brand)] data-[state=active]:border-b-white data-[state=active]:text-[var(--color-text-primary)] data-[state=active]:shadow-none">标签与注解</TabsTrigger>
                <TabsTrigger value="access" className="h-12 flex-none rounded-t-md rounded-b-none px-8 text-[var(--color-text-secondary)] data-[state=active]:border-[var(--color-brand)] data-[state=active]:border-b-white data-[state=active]:text-[var(--color-text-primary)] data-[state=active]:shadow-none">访问配置</TabsTrigger>
                <TabsTrigger value="upgrade" className="h-12 flex-none rounded-t-md rounded-b-none px-8 text-[var(--color-text-secondary)] data-[state=active]:border-[var(--color-brand)] data-[state=active]:border-b-white data-[state=active]:text-[var(--color-text-primary)] data-[state=active]:shadow-none">升级策略</TabsTrigger>
              </TabsList>
              <TabsContent value="metadata" className="space-y-8 px-6 py-6">
                <div className="space-y-4"><h3 className="text-sm font-medium text-[var(--color-text-primary)]">标签</h3><PairEditor title="工作负载标签" value={form.workloadLabelsText} onChange={(value) => patch("workloadLabelsText", value)} /><PairEditor title="容器组标签" value={form.podLabelsText} onChange={(value) => patch("podLabelsText", value)} /></div>
                <div className="space-y-4"><h3 className="text-sm font-medium text-[var(--color-text-primary)]">注解</h3><PairEditor title="工作负载注解" value={form.workloadAnnotationsText} onChange={(value) => patch("workloadAnnotationsText", value)} /><PairEditor title="容器组注解" value={form.podAnnotationsText} onChange={(value) => patch("podAnnotationsText", value)} /></div>
              </TabsContent>
              <TabsContent value="access" className="px-24 py-7">
                <div className="grid grid-cols-[100px_1fr] gap-5"><Label className="pt-1 text-right text-sm text-[var(--color-text-secondary)]">网络类型</Label><div className="space-y-4">{([ ["none", "不可访问", "工作负载不可访问"], ["portMapping", "端口映射", "配置端口映射后，流向主机端口的流量会映射到对应的容器端口"], ["hostNetwork", "主机网络", "使用边缘节点的网络，此时容器与主机间不做网络隔离，使用同一个 IP"] ] as const).map(([value, label, help]) => <label key={value} className="flex cursor-pointer items-start gap-2"><input type="radio" name="edge-app-network-mode" className="mt-1 h-4 w-4 accent-[var(--color-brand)]" checked={form.networkMode === value} onChange={() => change({ ...form, networkMode: value, hostNetwork: value === "hostNetwork", dnsPolicy: value === "hostNetwork" ? "ClusterFirstWithHostNet" : "ClusterFirst" })} /><span><span className="text-sm text-[var(--color-text-primary)]">{label}</span><span className="block text-xs text-[var(--color-text-tertiary)]">{help}</span></span></label>)}</div></div>
              </TabsContent>
              <TabsContent value="upgrade" className="space-y-5 px-12 py-6">
                <UpgradeRow label="升级方式"><Select value={form.strategyType} onValueChange={(value: EdgeApplicationForm["strategyType"]) => patch("strategyType", value)}><SelectTrigger className="max-w-60"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="RollingUpdate">滚动升级 (RollingUpdate)</SelectItem><SelectItem value="Recreate">重新创建 (Recreate)</SelectItem></SelectContent></Select></UpgradeRow>
                {form.strategyType === "RollingUpdate" && <><UpgradeRow label="最大无效 Pod 数" required help="滚动升级最大无效 Pod 数（最小可用 Pod 数 = 期望 Pod 数 - 最大无效 Pod 数）"><IntOrPercentInput value={form.maxUnavailable} onChange={(value) => patch("maxUnavailable", value)} /></UpgradeRow><UpgradeRow label="最大浪涌" required help="每次滚动升级允许超出所需规模的最大 Pod 数"><IntOrPercentInput value={form.maxSurge} onChange={(value) => patch("maxSurge", value)} /></UpgradeRow></>}
                <UpgradeRow label="最大保留版本数"><NumberWithUnit value={form.revisionHistoryLimit} unit="个" onChange={(value) => patch("revisionHistoryLimit", value)} /></UpgradeRow>
                <UpgradeRow label="Pod 可用最短时间" required help="Pod 就绪的最短时间，只有超出这个时间 Pod 才被认为可用"><NumberWithUnit value={form.minReadySeconds} unit="秒" onChange={(value) => patch("minReadySeconds", value)} /></UpgradeRow>
                <UpgradeRow label="升级最大持续时间" required help="在标记 Deployment 失败之前，等待部署进行的最小持续时间"><NumberWithUnit value={form.progressDeadlineSeconds} unit="秒" onChange={(value) => patch("progressDeadlineSeconds", value)} /></UpgradeRow>
                <UpgradeRow label="缩容时间窗" required help="工作负载停止前命令的执行时间窗（0-9,999 秒），默认 30 秒"><NumberWithUnit value={form.terminationGracePeriodSeconds} unit="秒" onChange={(value) => patch("terminationGracePeriodSeconds", value)} /></UpgradeRow>
              </TabsContent>
            </Tabs>
          </section>
        )}
      </main>
      <footer className="flex h-16 shrink-0 items-center justify-end gap-3 border-t bg-white px-6"><Button variant="ghost" onClick={props.onCancel}>取消</Button>{step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="mr-1 h-4 w-4" />上一步</Button>}{step < 2 ? <Button onClick={() => setStep(step + 1)} disabled={!props.canSubmit}>下一步<ChevronRight className="ml-1 h-4 w-4" /></Button> : <Button onClick={props.onSubmit} disabled={!props.canSubmit || props.submitting}>确认创建</Button>}</footer>
    </div>
  );
}
