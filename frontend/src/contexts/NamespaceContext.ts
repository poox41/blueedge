import { createContext, useContext } from "react";

export interface NamespaceOption {
  value: string;
  label: string;
}

export interface NamespaceContextValue {
  namespaces: NamespaceOption[];
  selectedNamespace: string;
  loading: boolean;
  error: string;
  selectNamespace: (namespace: string) => void;
  refreshNamespaces: () => Promise<void>;
}

export const NamespaceContext = createContext<NamespaceContextValue | null>(null);

export function useNamespace() {
  const context = useContext(NamespaceContext);
  if (!context) throw new Error("useNamespace must be used within NamespaceProvider");
  return context;
}
