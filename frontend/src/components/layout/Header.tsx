import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeftRight, Bell, ChevronDown, ChevronLeft, LogOut, RefreshCw, Server, Settings, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useEdgeUnits } from "@/contexts/EdgeUnitContext";
import { cn } from "@/lib/utils";
import { NamespaceBreadcrumbMenu } from "./NamespaceBreadcrumbMenu";

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

export function Header() {
  const { logout } = useAuth();
  const { edgeUnits, selectedEdgeUnit, loading, error, refreshEdgeUnits, selectEdgeUnit } = useEdgeUnits();
  const location = useLocation();
  const configDetailMatch = location.pathname.match(/^\/configmaps\/(?:config|secret)\/[^/]+\/([^/]+)$/);
  const ruleEndpointDetailMatch = location.pathname.match(/^\/ruleendpoints\/[^/]+\/([^/]+)$/);
  const nodeGroupDetailMatch = location.pathname.match(/^\/nodegroups\/([^/]+)$/);
  const deviceModelDetailMatch = location.pathname.match(/^\/devicemodels\/[^/]+\/([^/]+)$/);
  const deviceInstanceDetailMatch = location.pathname.match(/^\/deviceinstances\/[^/]+\/([^/]+)$/);
  const batchTaskDetailMatch = location.pathname.match(/^\/batchtasks\/[^/]+\/([^/]+)$/);
  const accessConfigDetailMatch = location.pathname.match(/^\/nodes\/access-config\/([^/]+)$/);
  const detailResourceName = configDetailMatch
    ? decodeURIComponent(configDetailMatch[1])
    : ruleEndpointDetailMatch
      ? decodeURIComponent(ruleEndpointDetailMatch[1])
      : nodeGroupDetailMatch
        ? decodeURIComponent(nodeGroupDetailMatch[1])
        : deviceModelDetailMatch
          ? decodeURIComponent(deviceModelDetailMatch[1])
          : deviceInstanceDetailMatch
            ? decodeURIComponent(deviceInstanceDetailMatch[1])
          : batchTaskDetailMatch
            ? decodeURIComponent(batchTaskDetailMatch[1])
        : "";
  const title = accessConfigDetailMatch ? "边缘节点" : configDetailMatch ? "配置项与密钥" : ruleEndpointDetailMatch ? "消息端点" : nodeGroupDetailMatch ? "边缘节点组" : deviceModelDetailMatch ? "设备模型" : deviceInstanceDetailMatch ? "终端设备" : batchTaskDetailMatch ? "批量任务" : routeTitles[location.pathname] || "概览";
  const showNamespace = !new Set(["/nodes", "/nodes/access", "/nodegroups", "/batchtasks"]).has(location.pathname) && !accessConfigDetailMatch && !nodeGroupDetailMatch && !batchTaskDetailMatch;
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white px-6">
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]">
          <ChevronLeft className="h-3.5 w-3.5" />
          边缘单元
        </Link>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]">
              <Server className="h-3.5 w-3.5 text-[var(--color-brand)]" />
              {loading ? "加载中..." : selectedEdgeUnit?.name || "暂无边缘单元"}
              <ChevronDown className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[224px] rounded-xl border-[var(--color-border)] p-2 shadow-xl">
            <DropdownMenuLabel className="px-3 py-2 text-xs font-semibold text-[var(--color-text-tertiary)]">
              切换边缘单元
            </DropdownMenuLabel>
            {edgeUnits.map((unit) => {
              const active = selectedEdgeUnit?.name === unit.name;
              return (
                <DropdownMenuItem
                  key={unit.name}
                  onClick={() => selectEdgeUnit(unit.name)}
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
            {!loading && edgeUnits.length === 0 && (
              <div className="px-3 py-3 text-xs text-[var(--color-text-tertiary)]">{error || "暂无可用边缘单元"}</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[var(--color-text-tertiary)]">/</span>
        {showNamespace && <><NamespaceBreadcrumbMenu /><span className="text-[var(--color-text-tertiary)]">/</span></>}
        <span className="font-semibold text-[var(--color-text-primary)]">{title}</span>
        {detailResourceName && <><span className="text-[var(--color-text-tertiary)]">/</span><span className="max-w-[240px] truncate font-semibold text-[var(--color-text-primary)]">{detailResourceName}</span></>}
      </div>

      <div className="flex items-center gap-2">
        {error && <span className="max-w-[260px] truncate text-xs text-[var(--color-danger)]" title={error}>{error}</span>}
        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]" aria-label="刷新边缘单元" onClick={() => void refreshEdgeUnits()} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
        <button type="button" className="relative flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)]" aria-label="通知">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--color-danger)]" />
        </button>
        <div className="relative ml-1" onMouseEnter={() => setUserMenuOpen(true)} onMouseLeave={() => setUserMenuOpen(false)}>
          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#111827] text-white transition-colors hover:bg-[#374151]" aria-label="用户菜单"><User className="h-3.5 w-3.5" /></button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 min-w-[160px] rounded-xl border border-[var(--color-border)] bg-white py-1.5 shadow-[var(--shadow-md)]">
              <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[#111827] transition-colors hover:bg-[var(--color-bg-hover)]"><Settings className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />个人设置</button>
              <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[#111827] transition-colors hover:bg-[var(--color-bg-hover)]"><ArrowLeftRight className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" />切换账号</button>
              <div className="mx-3 my-1 border-t border-[var(--color-border)]" />
              <button type="button" onClick={logout} className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-bg-hover)]"><LogOut className="h-3.5 w-3.5" />退出登录</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
