import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, ChevronDown, ChevronLeft, LogOut, RefreshCw, Server, Settings, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const routeTitles: Record<string, string> = {
  "/dashboard": "概览",
  "/nodes": "边缘节点",
  "/nodes/access": "边缘节点",
  "/nodegroups": "边缘节点组",
  "/batchtasks": "批量任务",
  "/devicemodels": "设备模型",
  "/deviceinstances": "终端设备",
  "/deployments": "工作负载",
  "/batchworkloads": "批量工作负载",
  "/pods": "Pods",
  "/edgeapps": "边缘应用",
  "/configmaps": "配置项与密钥",
  "/secrets": "Secrets",
  "/ruleendpoints": "消息端点",
  "/rules": "消息路由",
  "/persistentvolumes": "持久卷",
  "/persistentvolumeclaims": "持久卷声明",
  "/services": "服务",
  "/serviceaccounts": "服务账户",
  "/roles": "角色",
  "/rolebindings": "角色绑定",
  "/clusterroles": "集群角色",
  "/clusterrolebindings": "集群角色绑定",
  "/crds": "自定义资源定义",
};

const managedEdgeUnits = [
  { name: "edge-131", cluster: "ali-139-131", status: "运行中" },
  { name: "edge-riscv-prod", cluster: "arc01", status: "运行中" },
  { name: "edge-staging", cluster: "dev-cluster", status: "异常" },
  { name: "edge-guangzhou", cluster: "ali-gz-01", status: "运行中" },
  { name: "edge-beijing", cluster: "arc02", status: "创建中" },
];

export function Header() {
  const { logout } = useAuth();
  const location = useLocation();
  const title = routeTitles[location.pathname] || "概览";
  const [selectedUnit, setSelectedUnit] = useState(managedEdgeUnits[0]);

  return (
    <header className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white px-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
          <ChevronLeft className="h-3.5 w-3.5" />
          边缘单元
        </Link>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]">
              <Server className="h-3.5 w-3.5 text-[var(--color-brand)]" />
              {selectedUnit.name}
              <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[224px] rounded-xl border-[var(--color-border)] p-2 shadow-xl">
            <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold text-[var(--color-text-tertiary)]">
              切换边缘单元
            </DropdownMenuLabel>
            {managedEdgeUnits.map((unit) => {
              const active = selectedUnit.name === unit.name;
              return (
                <DropdownMenuItem
                  key={unit.name}
                  onClick={() => setSelectedUnit(unit)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)]",
                    active && "bg-[var(--color-brand-light)] text-[var(--color-brand)]",
                  )}
                >
                  <Server className={cn("h-4 w-4", active ? "text-[var(--color-brand)]" : "text-[var(--color-text-secondary)]")} />
                  <span className="min-w-0 flex-1 truncate">{unit.name}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <span className="font-semibold text-[var(--color-text-primary)]">{title}</span>
      </div>

      <div className="flex items-center gap-2">
        <button className="blueedge-icon-button" aria-label="刷新">
          <RefreshCw className="h-4 w-4" />
        </button>
        <button className="blueedge-icon-button relative" aria-label="通知">
          <Bell className="h-4 w-4" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--color-danger)] ring-2 ring-white" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 rounded-[10px] px-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-white">
                <User className="h-4 w-4" />
              </div>
              <span>dashboard-user</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[176px] rounded-xl border-[var(--color-border)]">
            <DropdownMenuItem className="cursor-pointer text-sm">
              <Settings className="mr-2 h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
              个人设置
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer text-sm text-[var(--color-danger)] focus:text-[var(--color-danger)]" onClick={logout}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
