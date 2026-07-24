import { ArrowLeftRight, LogOut, Settings, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

export function UserMenu() {
  const { logout } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-white transition-colors hover:bg-[#374151]"
          aria-label="用户菜单"
        >
          <User className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[160px] rounded-xl border-[var(--color-border)] p-1.5 shadow-[var(--shadow-md)]"
      >
        <DropdownMenuItem className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#111827]">
          <Settings className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          个人设置
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={logout}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[#111827]"
        >
          <ArrowLeftRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
          切换账号
        </DropdownMenuItem>
        <div className="mx-2 my-1 border-t border-[var(--color-border)]" />
        <DropdownMenuItem
          onSelect={logout}
          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[var(--color-danger)] focus:text-[var(--color-danger)]"
        >
          <LogOut className="h-3.5 w-3.5" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
