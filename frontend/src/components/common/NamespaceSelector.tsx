import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { listNamespaces } from "@/api/services/resources";

interface NamespaceSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function NamespaceSelector({ value, onChange }: NamespaceSelectorProps) {
  const [namespaces, setNamespaces] = useState<Array<{ value: string; label: string }>>([
    { value: "all", label: "全部命名空间" },
  ]);

  useEffect(() => {
    let active = true;
    listNamespaces()
      .then((items) => {
        if (active) setNamespaces(items);
      })
      .catch(() => {
        if (active) setNamespaces([{ value: "all", label: "全部命名空间" }]);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-[var(--color-text-secondary)] font-medium whitespace-nowrap">命名空间</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px] h-8 text-sm bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="w-[180px] max-h-[320px]">
          {namespaces.map((ns) => (
            <SelectItem key={ns.value} value={ns.value} className="text-sm truncate">
              {ns.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
