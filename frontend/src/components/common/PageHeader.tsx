import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, RefreshCw, Search } from "lucide-react";
import { NamespaceSelector } from "./NamespaceSelector";

interface PageHeaderProps {
  title: string;
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onAdd?: () => void;
  onRefresh?: () => void;
  addLabel?: string;
  description?: string;
  searchPlaceholder?: string;
}

export function PageHeader({
  title,
  namespace,
  onNamespaceChange,
  searchValue,
  onSearchChange,
  onAdd,
  onRefresh,
  addLabel = "添加",
  description = "管理当前边缘单元下的资源对象与运行状态。",
  searchPlaceholder = "请输入名称搜索",
}: PageHeaderProps) {
  return (
    <div className="mb-6 space-y-4">
      <div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">{title}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">{description}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {onSearchChange && (
            <div className="toolbar-search relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
              <Input
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-9 rounded-[10px] bg-white pl-9 text-sm"
              />
            </div>
          )}
        </div>
        {onNamespaceChange && namespace !== undefined && (
          <NamespaceSelector value={namespace} onChange={onNamespaceChange} />
        )}
        <div className="flex items-center gap-2">
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="blueedge-muted-button h-9 w-9 border-[var(--color-border-strong)] p-0"
              title="刷新"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          )}
          {onAdd && (
            <Button
              size="sm"
              onClick={onAdd}
              className="blueedge-primary-button h-9 px-3 text-sm"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {addLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
