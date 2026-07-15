import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNamespace } from "@/contexts/NamespaceContext";
import { cn } from "@/lib/utils";

export function NamespaceBreadcrumbMenu() {
  const { namespaces, selectedNamespace, loading, error, selectNamespace } = useNamespace();
  const label = namespaces.find((item) => item.value === selectedNamespace)?.label || selectedNamespace;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-10 items-center gap-2 rounded-[14px] px-3 text-sm font-semibold text-[var(--color-text-primary)] outline-none transition-colors hover:bg-[var(--color-bg-hover)] data-[state=open]:bg-[#f5f6f8]">
          {loading ? "加载中..." : label}
          <ChevronDown className="h-4 w-4 text-[#94a3b8]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="max-h-[420px] w-[200px] overflow-y-auto rounded-[18px] border border-[#e5e9f0] bg-white p-0 py-2 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
      >
        {namespaces.map((namespace) => (
          <DropdownMenuItem
            key={namespace.value}
            onClick={() => selectNamespace(namespace.value)}
            className={cn(
              "h-11 cursor-pointer rounded-none px-5 text-sm font-medium text-[var(--color-text-primary)] focus:bg-[#f3f6fb] focus:text-[var(--color-text-primary)]",
              selectedNamespace === namespace.value && "bg-[#eaf2ff] text-[#1677ff] focus:bg-[#eaf2ff] focus:text-[#1677ff]",
            )}
          >
            {namespace.label}
          </DropdownMenuItem>
        ))}
        {error && <div className="border-t border-[#eef1f5] px-5 py-3 text-xs text-[var(--color-danger)]">{error}</div>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
