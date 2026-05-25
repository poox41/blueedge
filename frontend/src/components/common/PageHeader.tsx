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
}: PageHeaderProps) {
  return (
    <div className="mb-5 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">{title}</h1>
        <div className="flex items-center gap-3">
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              刷新
            </Button>
          )}
          {onAdd && (
            <Button
              size="sm"
              onClick={onAdd}
              className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {addLabel}
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          {onSearchChange && (
            <div className="relative w-[280px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" />
              <Input
                placeholder="请输入名称搜索"
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-9 h-8 text-sm border-[#C9CDD4] focus-visible:ring-[#165DFF]"
              />
            </div>
          )}
        </div>
        {onNamespaceChange && namespace !== undefined && (
          <NamespaceSelector value={namespace} onChange={onNamespaceChange} />
        )}
      </div>
    </div>
  );
}
