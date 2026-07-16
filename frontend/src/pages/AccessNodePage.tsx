import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Download,
  ExternalLink,
  Info,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toAccessConfigUiModel, type AccessConfigInstallCommandResponse, type AccessConfigUiModel } from "@/api/adapters/access-config.adapter";
import { getAccessConfigInstallCommand, listAccessConfigs } from "@/api/services/product";
import { cn } from "@/lib/utils";
import { RequiredFieldError, useRequiredFieldValidation } from "@/hooks/useRequiredFieldValidation";

export function AccessNodePage() {
  const navigate = useNavigate();
  const [configs, setConfigs] = useState<AccessConfigUiModel[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [installCommand, setInstallCommand] = useState<AccessConfigInstallCommandResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [nodeName, setNodeName] = useState("");
  const formValidation = useRequiredFieldValidation<"config">();

  const selectedConfig = useMemo(
    () => configs.find((config) => config.name === selectedConfigId),
    [configs, selectedConfigId],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listAccessConfigs();
      const nextConfigs = result.items.map(toAccessConfigUiModel);
      setConfigs(nextConfigs);
      setSelectedConfigId((current) => {
        const nextSelectedConfig = nextConfigs.find((config) => config.name === current) || nextConfigs[0];
        return nextSelectedConfig?.name || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "接入配置加载失败");
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openSteps = async () => {
    if (!formValidation.validate([
      { field: "config", valid: Boolean(selectedConfig), message: "请选择接入配置", elementId: "access-node-config" },
    ]) || !selectedConfig) return;
    setRefreshing(true);
    setError("");
    try {
      const nextNodeName = nodeName.trim();
      const result = await getAccessConfigInstallCommand(selectedConfig.name, nextNodeName);
      setInstallCommand(result);
      setStepsOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "安装命令生成失败");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="blueedge-page space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/nodes")}
          className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回
        </button>
        <h1 className="text-lg font-bold text-[var(--color-text-primary)]">接入节点</h1>
      </div>

      <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-[#bfdbfe] bg-[#eaf2ff] p-4">
            <Info className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--color-brand)]" />
            <p className="text-sm leading-6 text-[var(--color-text-primary)]">
              请在需要接入的节点上执行以下步骤。在执行之前，请先配置节点环境，可参考
              <a href="https://docs.daocloud.io/kant/user-guide/node/join-rqmt.html" target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 font-semibold text-[var(--color-brand)]">
                节点规格要求 <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-[#fde68a] bg-[#fef3c7] p-4">
            <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[#d97706]" />
            <p className="text-sm leading-6 text-[#92400e]">以下操作均以 root 管理员执行，避免因权限不足导致安装失败</p>
          </div>

          <div className="table-card max-w-[920px] p-6">
            <div className="space-y-5">
              <div>
                <Label className="mb-1.5 block text-sm font-semibold text-[var(--color-text-primary)]">
                  接入配置 <span className="text-[var(--color-danger)]">*</span>
                </Label>
                <div className="flex items-center gap-3">
                  <Select value={selectedConfigId} onValueChange={(value) => {
                    setSelectedConfigId(value);
                    setNodeName("");
                    formValidation.clearError("config");
                  }}>
                    <SelectTrigger id="access-node-config" aria-invalid={Boolean(formValidation.errors.config)} className="h-11 flex-1 rounded-xl">
                      <SelectValue placeholder="请选择接入配置" />
                    </SelectTrigger>
                    <SelectContent>
                      {configs.map((config) => (
                        <SelectItem key={config.name} value={config.name}>
                          {config.name} — {config.cloudCoreAddress} / {config.protocol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button type="button" onClick={() => void loadData()} className="action-button h-10 w-10 rounded-xl" title="刷新">
                    <RefreshCw className={cn("h-4 w-4", (refreshing || loading) && "animate-spin")} />
                  </button>
                </div>
                <RequiredFieldError id="access-node-config-error" message={formValidation.errors.config} />
                <button type="button" onClick={() => navigate("/nodes?tab=access&create=1")} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-brand)]">
                  创建接入配置 <ExternalLink className="h-3 w-3" />
                </button>
              </div>

              {selectedConfig && (
                <div className="grid gap-3 rounded-xl bg-[var(--color-bg-soft)] p-4 md:grid-cols-3">
                  <DetailItem label="驱动方式" value={selectedConfig.driver || "未配置"} />
                  <DetailItem label="通信协议" value={selectedConfig.protocol} />
                  <DetailItem label="访问地址" value={selectedConfig.cloudCoreAddress} />
                </div>
              )}

              {selectedConfig && (
                <div>
                  <Label className="mb-2 block text-sm font-semibold text-[var(--color-text-primary)]">节点名称</Label>
                  <Input value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="请输入节点名称" className="h-11 rounded-xl" />
                  <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">如果不输入节点名称，将默认使用 hostname 作为节点名称</p>
                </div>
              )}
              {error && <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm text-[#c2410c]">{error}</div>}

              <Button disabled={refreshing} onClick={() => void openSteps()} className="h-10 rounded-xl bg-[var(--color-text-primary)] px-5 text-sm font-bold text-white hover:bg-[var(--color-text-primary)]/90">
                {refreshing ? "生成中..." : "获取接入步骤"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
      </div>

      {selectedConfig && installCommand && <AccessStepsDialog open={stepsOpen} installCommand={installCommand} onOpenChange={setStepsOpen} />}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-0.5 text-[11px] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]" title={value}>{value}</p>
    </div>
  );
}

function AccessStepsDialog({
  open,
  installCommand,
  onOpenChange,
}: {
  open: boolean;
  installCommand: AccessConfigInstallCommandResponse;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<"online" | "offline">("online");
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  const copyText = (text: string, step: number) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedStep(step);
    window.setTimeout(() => setCopiedStep(null), 1800);
  };

  const joinCommand = installCommand.command || installCommand.commandTemplate;
  const initCommandOnline = installCommand.prepareCommand || "在线安装命令暂不可用。";
  const initCommandOffline = "离线安装包下载能力尚未配置，当前后端会返回 501。";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[85vh] max-w-[720px] flex-col gap-0 overflow-hidden p-0" showCloseButton>
        <DialogHeader className="shrink-0 border-b border-[var(--color-border)] px-6 py-4">
          <DialogTitle className="text-base font-semibold">接入步骤</DialogTitle>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-6">
          <TabButton active={activeTab === "online"} onClick={() => setActiveTab("online")}>在线接入</TabButton>
          <TabButton active={activeTab === "offline"} onClick={() => setActiveTab("offline")}>离线接入</TabButton>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="flex items-start gap-2 rounded-xl border border-[#fde68a] bg-[#fef3c7] p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d97706]" />
            <p className="text-xs leading-5 text-[#92400e]">
              {installCommand.ready
                ? `当前命令可执行，请妥善保管短期凭证。${installCommand.expiresAt ? `凭证有效期至 ${new Date(installCommand.expiresAt).toLocaleString("zh-CN")}` : ""}`
                : `当前无法获取有效的 KubeEdge 接入凭证。${installCommand.missingRequirements.length ? `原因：${installCommand.missingRequirements.join("、")}` : ""}`}
            </p>
          </div>

          {activeTab === "online" ? (
            <>
              <StepBlock step={1} title="使用脚本准备 keadm 工具" warning="建议先创建一个空的工作目录，在该目录中运行脚本。" command={initCommandOnline} copied={copiedStep === 1} onCopy={() => copyText(initCommandOnline, 1)} />
              <StepBlock step={2} title="使用 keadm 工具接入节点" warning={installCommand.ready ? "请在 token 有效期内执行。" : "当前仅为命令模板，不能直接执行。"} command={joinCommand} copied={copiedStep === 2} onCopy={() => copyText(joinCommand, 2)} />
            </>
          ) : (
            <>
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <StepNum num={1} />
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">下载边缘端安装包和初始化脚本</h3>
                </div>
                <div className="ml-10">
                  <Button disabled className="h-10 rounded-xl bg-[var(--color-text-primary)] px-4 text-sm text-white opacity-60">
                    <Download className="h-3.5 w-3.5" />
                    下载暂未配置
                  </Button>
                  <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">尚未配置真实安装包或 edgecore 配置生成能力。</p>
                </div>
              </div>
              <StepBlock step={2} title="将安装包文件和脚本文件拷贝到边缘节点的同一目录下，并运行初始化脚本" warning="建议创建一个空的工作目录来存放相关文件。" command={initCommandOffline} copied={copiedStep === 3} onCopy={() => copyText(initCommandOffline, 3)} />
              <StepBlock step={3} title="执行命令接入节点" warning={installCommand.ready ? "请在 token 有效期内执行。" : "当前仅为命令模板，不能直接执行。"} command={joinCommand} copied={copiedStep === 4} onCopy={() => copyText(joinCommand, 4)} />
            </>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-[var(--color-border)] px-6 py-4">
          <Button onClick={() => onOpenChange(false)} className="h-9 rounded-xl bg-[var(--color-text-primary)] px-5 text-sm text-white hover:bg-[var(--color-text-primary)]/90">知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("relative px-4 py-3 text-sm font-semibold transition-colors", active ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]")}>
      {children}
      {active && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-[var(--color-text-primary)]" />}
    </button>
  );
}

function StepNum({ num }: { num: number }) {
  return <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-xs font-bold text-white">{num}</div>;
}

function StepBlock({ step, title, warning, command, copied, onCopy }: { step: number; title: string; warning: string; command: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <StepNum num={step} />
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
      </div>
      <div className="ml-10 space-y-3">
        <div className="rounded-lg bg-[var(--color-warning-soft)] p-3 text-xs leading-5 text-[#d97706]">{warning}</div>
        <div className="relative rounded-xl bg-[var(--color-text-primary)] p-4">
          <pre className="whitespace-pre-wrap break-all pr-20 font-mono text-xs leading-6 text-[#e5e7eb]">{command}</pre>
          <button type="button" onClick={onCopy} className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/25">
            {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </div>
    </div>
  );
}
