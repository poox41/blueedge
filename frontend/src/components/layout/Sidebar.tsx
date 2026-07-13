import { NavLink } from "react-router-dom";
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileCode,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Rocket,
  Route,
  Server,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const edgeUnit = {
  name: "edge-131",
  status: "运行中",
  type: "外接",
  cluster: "ali-139-131",
  version: "v1.21.0",
};

const navGroups = [
  {
    group: "",
    items: [{ label: "概览", icon: LayoutDashboard, path: "/dashboard" }],
  },
  {
    group: "边缘资源",
    items: [
      { label: "边缘节点", icon: Server, path: "/nodes" },
      { label: "边缘节点组", icon: Settings2, path: "/nodegroups" },
      { label: "设备模型", icon: Cpu, path: "/devicemodels" },
      { label: "终端设备", icon: Box, path: "/deviceinstances" },
      { label: "批量任务", icon: Rocket, path: "/batchtasks" },
    ],
  },
  {
    group: "边缘应用",
    items: [
      { label: "工作负载", icon: Layers, path: "/deployments" },
      { label: "批量工作负载", icon: Layers, path: "/batchworkloads" },
      { label: "配置项与密钥", icon: FileCode, path: "/configmaps" },
    ],
  },
  {
    group: "边云消息",
    items: [
      { label: "消息端点", icon: MessageSquare, path: "/ruleendpoints" },
      { label: "消息路由", icon: Route, path: "/rules" },
    ],
  },
];

function StatusPill({ children, tone = "success" }: { children: React.ReactNode; tone?: "success" | "warning" }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-semibold", tone === "success" ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-warning-soft)] text-[#f57c00]")}>
      {tone === "success" && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-[#e8ecf3] bg-white transition-all duration-200",
        collapsed ? "w-[72px]" : "w-[240px]"
      )}
    >
      <div className="flex h-[72px] shrink-0 items-center border-b border-[#e8ecf3] px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-text-primary)]">
          <Box className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <span className="ml-3 text-sm font-bold text-[var(--color-text-primary)]">
            BlueEdge
          </span>
        )}
      </div>

      <nav className={cn("min-h-0 flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
        {navGroups.map((group) => (
          <div key={group.group || "root"}>
            {group.group && !collapsed && (
              <div className="mb-2 mt-5 px-3 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
                {group.group}
              </div>
            )}
            {group.group && collapsed && <div className="mt-5" />}
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={`${group.group}-${item.label}`}
                  to={item.path}
                  className={({ isActive }) => cn(
                    "relative mb-0.5 flex h-10 items-center rounded-[10px] px-3 text-sm font-medium transition-colors",
                    collapsed && "justify-center",
                    isActive ? "bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]" : "text-[#5f6368] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && !collapsed && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-text-primary)]" />}
                      <Icon className="h-[18px] w-[18px]" />
                      {!collapsed && <span className="ml-3">{item.label}</span>}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="shrink-0 px-3 pb-3">
          <div className="rounded-[22px] border border-[#e8ecf3] bg-[#f6f7f9] p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <div className="mb-3 flex items-center justify-between">
              <StatusPill>{edgeUnit.status}</StatusPill>
              <StatusPill tone="warning">{edgeUnit.type}</StatusPill>
            </div>
            <h3 className="mb-2 truncate text-sm font-bold text-[var(--color-text-primary)]">{edgeUnit.name}</h3>
            <div className="space-y-1 text-[11px] text-[var(--color-text-secondary)]">
              <div className="flex items-center gap-1.5"><Server className="h-3 w-3 text-[var(--color-text-tertiary)]" />{edgeUnit.cluster}</div>
              <div className="flex items-center gap-1.5"><Box className="h-3 w-3 text-[var(--color-text-tertiary)]" />KubeEdge {edgeUnit.version}</div>
            </div>
            <div className="my-3 border-t border-[#e8ecf3]" />
            <NavLink to="/" className="flex h-8 items-center justify-center gap-1.5 rounded-xl border border-[#e8ecf3] bg-white text-xs font-semibold text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-text-primary)] hover:text-white">
              <ChevronLeft className="h-3.5 w-3.5" />
              返回列表
            </NavLink>
          </div>
        </div>
      )}

      {collapsed && (
        <div className="flex shrink-0 justify-center pb-3">
          <button onClick={onToggle} className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e8ecf3] bg-[#f6f7f9]">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
          </button>
        </div>
      )}

      <div className="flex h-[52px] shrink-0 items-center border-t border-[#eef1f5] px-5">
        <button
          onClick={onToggle}
          className={cn(
            "flex h-9 w-full items-center gap-2 rounded-lg text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
            collapsed ? "justify-center" : "justify-start px-2"
          )}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span className="text-xs">收起侧边栏</span>}
        </button>
      </div>
    </aside>
  );
}
