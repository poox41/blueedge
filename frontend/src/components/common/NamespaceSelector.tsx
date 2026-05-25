import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { namespaces } from "@/data/mockData";

interface NamespaceSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export function NamespaceSelector({ value, onChange }: NamespaceSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-[#4E5969] font-medium whitespace-nowrap">命名空间</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px] h-8 text-sm border-[#C9CDD4] bg-white hover:border-[#165DFF] transition-colors focus:ring-1 focus:ring-[#165DFF]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="min-w-[180px]">
          {namespaces.map((ns) => (
            <SelectItem key={ns.value} value={ns.value} className="text-sm">
              {ns.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
