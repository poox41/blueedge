import { useState } from "react";
import { cn } from "@/lib/utils";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Briefcase,
  HardDrive,
  Cpu,
  Network,
  Globe,
  ShieldCheck,
  KeyRound,
  FileCode,
  ChevronDown,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Layers,
  Box,
  FileText,
} from "lucide-react";

interface MenuItem {
  key: string;
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: MenuItem[];
}

const menuItems: MenuItem[] = [
  { key: "dashboard", label: "仪表板", icon: LayoutDashboard, path: "/" },
  {
    key: "edge",
    label: "边缘",
    icon: Server,
    children: [
      { key: "nodes", label: "节点", icon: Server, path: "/nodes" },
      { key: "nodegroups", label: "节点组", icon: Layers, path: "/nodegroups" },
    ],
  },
  {
    key: "workloads",
    label: "工作负载",
    icon: Briefcase,
    children: [
      { key: "deployments", label: "部署", icon: Briefcase, path: "/deployments" },
      { key: "pods", label: "Pods", icon: Box, path: "/pods" },
      { key: "edgeapps", label: "边缘应用", icon: Briefcase, path: "/edgeapps" },
    ],
  },
  {
    key: "storage",
    label: "存储",
    icon: HardDrive,
    children: [
      { key: "persistentvolumes", label: "持久卷", icon: HardDrive, path: "/persistentvolumes" },
      { key: "persistentvolumeclaims", label: "持久卷声明", icon: HardDrive, path: "/persistentvolumeclaims" },
    ],
  },
  {
    key: "devices",
    label: "设备",
    icon: Cpu,
    children: [
      { key: "devicemodels", label: "设备模型", icon: Cpu, path: "/devicemodels" },
      { key: "deviceinstances", label: "设备实例", icon: Cpu, path: "/deviceinstances" },
    ],
  },
  {
    key: "network",
    label: "网络",
    icon: Network,
    children: [
      { key: "ruleendpoints", label: "规则端点", icon: Network, path: "/ruleendpoints" },
      { key: "rules", label: "规则", icon: Network, path: "/rules" },
    ],
  },
  {
    key: "services",
    label: "服务",
    icon: Globe,
    path: "/services",
  },
  {
    key: "config",
    label: "配置",
    icon: FileText,
    children: [
      { key: "configmaps", label: "配置字典", icon: FileText, path: "/configmaps" },
      { key: "secrets", label: "Secrets", icon: KeyRound, path: "/secrets" },
    ],
  },
  {
    key: "security",
    label: "安全",
    icon: ShieldCheck,
    children: [
      { key: "serviceaccounts", label: "服务账户", icon: ShieldCheck, path: "/serviceaccounts" },
      { key: "roles", label: "角色", icon: ShieldCheck, path: "/roles" },
      { key: "rolebindings", label: "角色绑定", icon: ShieldCheck, path: "/rolebindings" },
      { key: "clusterroles", label: "集群角色", icon: ShieldCheck, path: "/clusterroles" },
      { key: "clusterrolebindings", label: "集群角色绑定", icon: ShieldCheck, path: "/clusterrolebindings" },
    ],
  },
  {
    key: "crds",
    label: "自定义资源定义",
    icon: FileCode,
    path: "/crds",
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const [expandedKeys, setExpandedKeys] = useState<string[]>(["edge", "workloads", "storage", "devices", "network", "config", "security"]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const isActive = (path?: string) => {
    if (!path) return false;
    return location.pathname === path;
  };

  const isParentActive = (item: MenuItem) => {
    if (item.children) {
      return item.children.some((child) => isActive(child.path));
    }
    return false;
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-full bg-[#F7F8FA] border-r border-[#E5E6EB] z-40 transition-all duration-300 ease-in-out flex flex-col",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-[#E5E6EB] bg-white">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-[#165DFF] flex items-center justify-center flex-shrink-0">
            <Layers className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold text-[#1D2129] whitespace-nowrap">
              BlueEdge
            </span>
          )}
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {menuItems.map((item) => {
          const hasChildren = item.children && item.children.length > 0;
          const isExpanded = expandedKeys.includes(item.key);
          const parentActive = isParentActive(item);

          if (hasChildren) {
            return (
              <div key={item.key} className="mb-1">
                <button
                  onClick={() => toggleExpand(item.key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-all duration-200",
                    collapsed
                      ? "justify-center"
                      : "justify-between",
                    parentActive
                      ? "bg-[#E8F3FF] text-[#165DFF] font-medium"
                      : "text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129]"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!collapsed && (
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 transition-transform duration-200",
                        isExpanded ? "rotate-180" : ""
                      )}
                    />
                  )}
                </button>
                {!collapsed && isExpanded && (
                  <div className="mt-1 ml-2 pl-4 border-l border-[#E5E6EB] space-y-0.5">
                    {item.children?.map((child) => (
                      <NavLink
                        key={child.key}
                        to={child.path || ""}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-all duration-200",
                          isActive(child.path)
                            ? "bg-[#E8F3FF] text-[#165DFF] font-medium"
                            : "text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129]"
                        )}
                      >
                        <span className="w-1 h-1 rounded-full bg-current flex-shrink-0" />
                        <span className="truncate">{child.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={item.key} className="mb-1">
              <NavLink
                to={item.path || ""}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-all duration-200",
                  collapsed ? "justify-center" : "",
                  isActive(item.path)
                    ? "bg-[#E8F3FF] text-[#165DFF] font-medium"
                    : "text-[#4E5969] hover:bg-[#F2F3F5] hover:text-[#1D2129]"
                )}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            </div>
          );
        })}
      </nav>

      {/* Toggle button */}
      <div className="h-10 border-t border-[#E5E6EB] flex items-center justify-center bg-white">
        <button
          onClick={onToggle}
          className="w-full h-full flex items-center justify-center text-[#86909C] hover:text-[#165DFF] transition-colors"
        >
          {collapsed ? (
            <ChevronRightIcon className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>
    </aside>
  );
}
