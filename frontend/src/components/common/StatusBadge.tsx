import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  color?: string;
  className?: string;
}

const statusMap: Record<string, { bg: string; text: string; dot: string }> = {
  success: { bg: "bg-[#E8FFEA]", text: "text-[#00B42A]", dot: "bg-[#00B42A]" },
  warning: { bg: "bg-[#FFF7E8]", text: "text-[#FF7D00]", dot: "bg-[#FF7D00]" },
  error: { bg: "bg-[#FFECE8]", text: "text-[#F53F3F]", dot: "bg-[#F53F3F]" },
  info: { bg: "bg-[#E8F3FF]", text: "text-[#165DFF]", dot: "bg-[#165DFF]" },
  default: { bg: "bg-[#F2F3F5]", text: "text-[#4E5969]", dot: "bg-[#C9CDD4]" },
};

export function StatusBadge({ status, color, className }: StatusBadgeProps) {
  const key = color || "default";
  const style = statusMap[key] || statusMap.default;

  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-normal border-0 px-2.5 py-0.5 text-xs rounded-md gap-1.5",
        style.bg,
        style.text,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", style.dot)} />
      {status}
    </Badge>
  );
}
