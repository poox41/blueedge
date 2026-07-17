import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getEdgeUnitResources } from "@/api/services/product";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";
import { useNamespace } from "@/contexts/NamespaceContext";
import { cn } from "@/lib/utils";

export function NamespaceBreadcrumbMenu() {
  const { namespaces: clusterNamespaces, selectedNamespace, loading: clusterLoading, error: clusterError, selectNamespace } = useNamespace();
  const { selectedEdgeUnitName } = useEdgeUnits();
  const location = useLocation();
  const resourceKind = location.pathname === "/edgeapps"
    ? "edgeApplications"
    : null;
  const [relatedNamespaces, setRelatedNamespaces] = useState<string[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState("");

  useEffect(() => {
    if (!resourceKind || !selectedEdgeUnitName) {
      setRelatedNamespaces([]);
      setScopeError("");
      return;
    }
    let active = true;
    setRelatedNamespaces([]);
    setScopeLoading(true);
    setScopeError("");
    getEdgeUnitResources(selectedEdgeUnitName)
      .then((response) => {
        if (!active) return;
        const namespaces = Array.from(new Set(response.item[resourceKind].map((item) => item.namespace || "default"))).sort();
        setRelatedNamespaces(namespaces);
      })
      .catch((cause) => {
        if (!active) return;
        setRelatedNamespaces([]);
        setScopeError(cause instanceof Error ? cause.message : "边缘单元命名空间范围加载失败");
      })
      .finally(() => {
        if (active) setScopeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resourceKind, selectedEdgeUnitName]);

  const namespaces = useMemo(() => resourceKind
    ? [
        { value: "all", label: "全部相关命名空间" },
        ...relatedNamespaces.map((namespace) => ({ value: namespace, label: namespace })),
      ]
    : clusterNamespaces, [clusterNamespaces, relatedNamespaces, resourceKind]);

  useEffect(() => {
    if (!resourceKind || scopeLoading) return;
    if (!namespaces.some((item) => item.value === selectedNamespace)) selectNamespace("all");
  }, [namespaces, resourceKind, scopeLoading, selectNamespace, selectedNamespace]);

  const loading = resourceKind ? scopeLoading : clusterLoading;
  const error = resourceKind ? scopeError : clusterError;
  const label = namespaces.find((item) => item.value === selectedNamespace)?.label || (resourceKind ? "全部相关命名空间" : selectedNamespace);

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
