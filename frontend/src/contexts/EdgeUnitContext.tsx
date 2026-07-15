import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { listEdgeUnits } from "@/api/services/product";
import type { EdgeUnitView } from "@/api/adapters/edge-unit.adapter";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "blueedge.selectedEdgeUnit";

interface EdgeUnitContextValue {
  edgeUnits: EdgeUnitView[];
  selectedEdgeUnit: EdgeUnitView | null;
  selectedEdgeUnitName: string | null;
  loading: boolean;
  error: string | null;
  warnings: string[];
  refreshEdgeUnits: () => Promise<void>;
  selectEdgeUnit: (name: string) => void;
}

const EdgeUnitContext = createContext<EdgeUnitContextValue | null>(null);

export function EdgeUnitProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [edgeUnits, setEdgeUnits] = useState<EdgeUnitView[]>([]);
  const [selectedEdgeUnitName, setSelectedEdgeUnitName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const refreshEdgeUnits = useCallback(async () => {
    if (!isAuthenticated) {
      setEdgeUnits([]);
      setSelectedEdgeUnitName(null);
      setError(null);
      setWarnings([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await listEdgeUnits();
      setEdgeUnits(result.items);
      setWarnings((result.warnings || []).map((warning) => `${warning.source}: ${warning.message}`));
      setSelectedEdgeUnitName((current) => {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const preferred = current || stored;
        const next = result.items.find((item) => item.name === preferred)?.name || result.items[0]?.name || null;
        if (next) window.localStorage.setItem(STORAGE_KEY, next);
        else window.localStorage.removeItem(STORAGE_KEY);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "边缘单元加载失败");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refreshEdgeUnits();
  }, [refreshEdgeUnits]);

  const selectEdgeUnit = useCallback((name: string) => {
    setSelectedEdgeUnitName((current) => {
      if (!edgeUnits.some((item) => item.name === name)) return current;
      window.localStorage.setItem(STORAGE_KEY, name);
      return name;
    });
  }, [edgeUnits]);

  const selectedEdgeUnit = useMemo(
    () => edgeUnits.find((item) => item.name === selectedEdgeUnitName) || null,
    [edgeUnits, selectedEdgeUnitName],
  );

  const value = useMemo<EdgeUnitContextValue>(() => ({
    edgeUnits,
    selectedEdgeUnit,
    selectedEdgeUnitName,
    loading,
    error,
    warnings,
    refreshEdgeUnits,
    selectEdgeUnit,
  }), [edgeUnits, error, loading, refreshEdgeUnits, selectEdgeUnit, selectedEdgeUnit, selectedEdgeUnitName, warnings]);

  return <EdgeUnitContext.Provider value={value}>{children}</EdgeUnitContext.Provider>;
}

export function useEdgeUnits(): EdgeUnitContextValue {
  const context = useContext(EdgeUnitContext);
  if (!context) throw new Error("useEdgeUnits must be used within EdgeUnitProvider");
  return context;
}
