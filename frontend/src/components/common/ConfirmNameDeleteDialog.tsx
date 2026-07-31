import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { copyToClipboard } from "@/lib/clipboard";

type ConfirmNameDeleteDialogProps = {
  name: string | null | undefined;
  warning?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmNameDeleteDialog({
  name,
  warning = "此操作不可恢复。删除后相关资源将被永久移除。",
  loading = false,
  onOpenChange,
  onConfirm,
}: ConfirmNameDeleteDialogProps) {
  const [confirmName, setConfirmName] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setConfirmName("");
    setCopied(false);
  }, [name]);

  const copyName = async () => {
    if (!name) return;
    setConfirmName(name);
    setCopied(await copyToClipboard(name));
  };

  return (
    <AlertDialog open={Boolean(name)} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[480px] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[480px]">
        <AlertDialogHeader className="flex h-[61px] flex-row items-center justify-between border-b border-[#f0f1f3] px-6 text-left">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff4d4f]/10">
              <AlertTriangle className="h-4 w-4 text-[#ff4d4f]" />
            </span>
            <AlertDialogTitle className="truncate text-sm">确认删除「{name}」吗？</AlertDialogTitle>
          </div>
          <AlertDialogCancel className="action-button m-0 h-8 w-8 shrink-0 rounded-[10px] border-[#e8ecf3] p-0" disabled={loading}>
            <X className="h-4 w-4" />
          </AlertDialogCancel>
        </AlertDialogHeader>
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-2 rounded-lg border border-[#ffd591] bg-[#fff7e6] p-3">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#fa8c16]" />
            <p className="text-xs leading-5 text-[#ad6800]">{warning}</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="min-w-0 text-xs font-medium text-[#111827]">
                请输入 <strong className="break-all text-[#ff4d4f]">{name}</strong> 以确认删除
              </label>
              <button type="button" onClick={() => void copyName()} className="flex shrink-0 items-center gap-1 text-xs text-[#1a73e8]">
                {copied ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Copy className="h-3 w-3" />}
                {copied ? "已复制" : "复制名称"}
              </button>
            </div>
            <Input autoFocus value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={name || ""} className="h-10 rounded-[10px]" />
          </div>
        </div>
        <AlertDialogFooter className="h-[69px] border-t border-[#f0f1f3] px-6 py-4">
          <AlertDialogCancel className="btn-secondary m-0" disabled={loading}>取消</AlertDialogCancel>
          <AlertDialogAction className="h-9 rounded-[10px] px-5 text-sm" disabled={!name || confirmName !== name || loading} onClick={() => void onConfirm()}>
            {loading ? "删除中..." : "删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
