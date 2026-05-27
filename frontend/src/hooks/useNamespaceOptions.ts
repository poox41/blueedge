import { useEffect, useState } from "react";
import { listNamespaces } from "@/api/services/resources";

export interface NamespaceOption {
  value: string;
  label: string;
}

const fallbackNamespaces: NamespaceOption[] = [{ value: "default", label: "default" }];

export function useNamespaceOptions() {
  const [namespaces, setNamespaces] = useState<NamespaceOption[]>(fallbackNamespaces);

  useEffect(() => {
    let active = true;
    listNamespaces()
      .then((items) => {
        if (!active) return;
        const usable = items.filter((item) => item.value !== "all");
        setNamespaces(usable.length > 0 ? usable : fallbackNamespaces);
      })
      .catch(() => {
        if (active) setNamespaces(fallbackNamespaces);
      });

    return () => {
      active = false;
    };
  }, []);

  return namespaces;
}
