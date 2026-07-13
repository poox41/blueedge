import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  color?: string;
  className?: string;
}

const statusMap: Record<string, { bg: string; text: string; dot: string }> = {
  success: { bg: "bg-[var(--color-success-soft)]", text: "text-[var(--color-success)]", dot: "bg-[var(--color-success)]" },
  warning: { bg: "bg-[var(--color-warning-soft)]", text: "text-[var(--color-warning)]", dot: "bg-[var(--color-warning)]" },
  error: { bg: "bg-[var(--color-danger-soft)]", text: "text-[var(--color-danger)]", dot: "bg-[var(--color-danger)]" },
  info: { bg: "bg-[var(--color-brand-light)]", text: "text-[var(--color-brand)]", dot: "bg-[var(--color-brand)]" },
  default: { bg: "bg-[var(--color-bg-soft)]", text: "text-[var(--color-text-secondary)]", dot: "bg-[var(--color-text-tertiary)]" },
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
