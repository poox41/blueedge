import { Bell, User, ChevronDown, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";

export function Header() {
  const { logout } = useAuth();

  return (
    <header className="h-14 bg-white border-b border-[#E5E6EB] flex items-center justify-between px-6 sticky top-0 z-30">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[#4E5969]">BlueEdge 边缘智能平台</span>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 text-[#4E5969] hover:text-[#165DFF] hover:bg-[#F2F3F5] relative"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#F53F3F] rounded-full" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 gap-2 text-sm text-[#4E5969] hover:text-[#1D2129] hover:bg-[#F2F3F5]"
            >
              <div className="w-6 h-6 rounded-full bg-[#165DFF] flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-white" />
              </div>
              <span>dashboard-user</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem className="text-sm cursor-pointer">个人设置</DropdownMenuItem>
            <DropdownMenuItem
              className="text-sm cursor-pointer text-[#F53F3F] focus:text-[#F53F3F]"
              onClick={logout}
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
