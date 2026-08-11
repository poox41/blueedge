import { useCallback, useEffect, useMemo, useState } from "react";
import { listNamespaces } from "@/api/services/resources";
import { NamespaceContext, type NamespaceOption } from "@/contexts/NamespaceContext";
import { useAuth } from "@/contexts/auth-context";

const STORAGE_KEY = "blueedge:selected-namespace";
const fallbackNamespaces: NamespaceOption[] = [
  { value: "all", label: "全部命名空间" },
  { value: "default", label: "default" },
];

function normalizeNamespaces(items: NamespaceOption[]) {
  const normalized = items.some((item) => item.value === "all")
    ? items
    : [{ value: "all", label: "全部命名空间" }, ...items];
  return normalized.length > 1 ? normalized : fallbackNamespaces;
}

export function NamespaceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [namespaces, setNamespaces] = useState<NamespaceOption[]>(fallbackNamespaces);
  const [selectedNamespace, setSelectedNamespace] = useState(() => localStorage.getItem(STORAGE_KEY) || "all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const applyNamespaces = useCallback((items: NamespaceOption[]) => {
    const next = normalizeNamespaces(items);
    setNamespaces(next);
    setSelectedNamespace((current) => {
      const value = next.some((item) => item.value === current) ? current : "all";
      localStorage.setItem(STORAGE_KEY, value);
      return value;
    });
  }, []);

  const refreshNamespaces = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      applyNamespaces(await listNamespaces());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "命名空间加载失败");
      setNamespaces(fallbackNamespaces);
    } finally {
      setLoading(false);
    }
  }, [applyNamespaces]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let active = true;
    listNamespaces()
      .then((items) => {
        if (active) applyNamespaces(items);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "命名空间加载失败");
        setNamespaces(fallbackNamespaces);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyNamespaces, isAuthenticated]);

  const selectNamespace = useCallback((namespace: string) => {
    setSelectedNamespace(namespace);
    localStorage.setItem(STORAGE_KEY, namespace);
  }, []);

  const value = useMemo(() => ({
    namespaces,
    selectedNamespace,
    loading,
    error,
    selectNamespace,
    refreshNamespaces,
  }), [error, loading, namespaces, refreshNamespaces, selectNamespace, selectedNamespace]);

  return <NamespaceContext.Provider value={value}>{children}</NamespaceContext.Provider>;
}
