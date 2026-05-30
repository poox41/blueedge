import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import { getClusterMetrics, getClusterMetricsHistory, listClusterEvents, type ClusterEvent, type ClusterMetrics } from "@/api/services/product";
import { listDeployments, listNodes } from "@/api/services/resources";
import type { EdgeNodeView, WorkloadView } from "@/types/kubeedge";
import { useEffect, useState } from "react";
import {
  Server,
  Boxes,
  Cpu,
  MemoryStick,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

const emptyTrendData = [
  { name: "-", usage: 0 },
];

function formatTrendTime(timestamp?: string): string {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function Dashboard() {
  const [nodes, setNodes] = useState<EdgeNodeView[]>([]);
  const [deployments, setDeployments] = useState<WorkloadView[]>([]);
  const [metrics, setMetrics] = useState<ClusterMetrics | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<ClusterMetrics[]>([]);
  const [events, setEvents] = useState<ClusterEvent[]>([]);
  const [metricsError, setMetricsError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadDashboard() {
      setError("");
      try {
        const [nodeList, deploymentList, metricsResult, metricsHistoryResult, eventList] = await Promise.allSettled([
          listNodes(),
          listDeployments(),
          getClusterMetrics(),
          getClusterMetricsHistory(),
          listClusterEvents(),
        ]);
        if (!mounted) return;
        if (nodeList.status === "fulfilled") setNodes(nodeList.value);
        if (deploymentList.status === "fulfilled") setDeployments(deploymentList.value);
        if (metricsHistoryResult.status === "fulfilled") setMetricsHistory(metricsHistoryResult.value.items);
        if (eventList.status === "fulfilled") setEvents(eventList.value);
        if (metricsResult.status === "fulfilled") {
          setMetrics(metricsResult.value);
          setMetricsError("");
        } else {
          setMetrics(null);
          setMetricsError(metricsResult.reason instanceof Error ? metricsResult.reason.message : "metrics 未接入");
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "加载仪表板数据失败");
      }
    }

    void loadDashboard();
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 60_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const readyNodes = nodes.filter((node) => node.status === "Ready").length;
  const notReadyNodes = Math.max(0, nodes.length - readyNodes);
  const runningDeployments = deployments.filter((item) => item.availableReplicas > 0).length;
  const inactiveDeployments = Math.max(0, deployments.length - runningDeployments);
  const edgeNodes = nodes.filter((node) => node.role === "edge").length;
  const cloudNodes = nodes.filter((node) => node.role === "cloud").length;
  const unknownNodes = Math.max(0, nodes.length - edgeNodes - cloudNodes);
  const nodeStatus = [
    { name: "云端节点", value: cloudNodes, color: "#165DFF" },
    { name: "边缘节点", value: edgeNodes, color: "#00B42A" },
    { name: "未知角色", value: unknownNodes, color: "#86909C" },
  ].filter((item) => item.value > 0);
  const deploymentStatus = [
    { name: "运行中", value: runningDeployments, color: "#00B42A" },
    { name: "未就绪", value: inactiveDeployments, color: "#FF7D00" },
  ].filter((item) => item.value > 0);
  const recentEvents = events.map((event) => ({
    type: event.type === "Warning" ? "warning" : "success",
    message: `${event.involvedObject.kind}/${event.involvedObject.name} ${event.reason}: ${event.message}`,
    time: event.lastTimestamp || "-",
  }));
  const cpuPercent = metrics?.cpu.percent ?? 0;
  const memoryPercent = metrics?.memory.percent ?? 0;
  const cpuTrendData = metricsHistory.length > 0
    ? metricsHistory.map((item) => ({ name: formatTrendTime(item.timestamp), usage: item.cpu.percent }))
    : emptyTrendData;
  const memoryTrendData = metricsHistory.length > 0
    ? metricsHistory.map((item) => ({ name: formatTrendTime(item.timestamp), usage: item.memory.percent }))
    : emptyTrendData;
  const memoryUsedGi = metrics ? (metrics.memory.usedBytes / 1024 ** 3).toFixed(1) : "-";
  const memoryCapacityGi = metrics ? (metrics.memory.capacityBytes / 1024 ** 3).toFixed(1) : "-";

  const eventIcon = (type: string) => {
    switch (type) {
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-[#00B42A]" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-[#FF7D00]" />;
      case "error":
        return <XCircle className="w-4 h-4 text-[#F53F3F]" />;
      default:
        return <Info className="w-4 h-4 text-[#165DFF]" />;
    }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">{error}</div>}
      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-[#E5E6EB] shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#86909C] mb-1">节点状态</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#1D2129]">{readyNodes}</span>
                  <span className="text-sm text-[#00B42A]">就绪</span>
                </div>
                {notReadyNodes > 0 && (
                  <p className="text-xs text-[#F53F3F] mt-1">{notReadyNodes} 未就绪</p>
                )}
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#E8FFEA] flex items-center justify-center">
                <Server className="w-5 h-5 text-[#00B42A]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E5E6EB] shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#86909C] mb-1">部署状态</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#1D2129]">{runningDeployments}</span>
                  <span className="text-sm text-[#00B42A]">运行中</span>
                </div>
                {inactiveDeployments > 0 && (
                  <p className="text-xs text-[#FF7D00] mt-1">{inactiveDeployments} 不活跃</p>
                )}
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#E8F3FF] flex items-center justify-center">
                <Boxes className="w-5 h-5 text-[#165DFF]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E5E6EB] shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#86909C] mb-1">处理器使用率</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#1D2129]">{metrics ? `${cpuPercent}%` : "-"}</span>
                  <span className="text-sm text-[#4E5969]">{metrics ? `${metrics.cpu.usedMillicores}m / ${metrics.cpu.capacityMillicores}m` : "metrics 未接入"}</span>
                </div>
                {metricsError && <p className="text-xs text-[#FF7D00] mt-1">{metricsError}</p>}
                <div className="w-full h-1.5 bg-[#F2F3F5] rounded-full mt-2">
                  <div
                    className="h-full rounded-full bg-[#165DFF]"
                    style={{ width: `${Math.min(100, cpuPercent)}%` }}
                  />
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#FFF7E8] flex items-center justify-center">
                <Cpu className="w-5 h-5 text-[#FF7D00]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E5E6EB] shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#86909C] mb-1">内存使用率</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#1D2129]">{metrics ? `${memoryPercent}%` : "-"}</span>
                  <span className="text-sm text-[#4E5969]">{metrics ? `${memoryUsedGi}Gi / ${memoryCapacityGi}Gi` : "metrics 未接入"}</span>
                </div>
                <div className="w-full h-1.5 bg-[#F2F3F5] rounded-full mt-2">
                  <div
                    className="h-full rounded-full bg-[#00B42A]"
                    style={{ width: `${Math.min(100, memoryPercent)}%` }}
                  />
                </div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-[#E8FFEA] flex items-center justify-center">
                <MemoryStick className="w-5 h-5 text-[#00B42A]" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* CPU Chart */}
        <Card className="border-[#E5E6EB] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1D2129]">CPU 使用趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={cpuTrendData}>
                <defs>
                  <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#165DFF" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#165DFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F3F5" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#86909C" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#86909C" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #E5E6EB", fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="usage"
                  stroke="#165DFF"
                  strokeWidth={2}
                  fill="url(#cpuGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Memory Chart */}
        <Card className="border-[#E5E6EB] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1D2129]">内存使用趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={memoryTrendData}>
                <defs>
                  <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00B42A" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#00B42A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F2F3F5" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#86909C" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#86909C" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #E5E6EB", fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="usage"
                  stroke="#00B42A"
                  strokeWidth={2}
                  fill="url(#memGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Events */}
        <Card className="border-[#E5E6EB] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1D2129]">最近事件</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[200px] overflow-y-auto">
              {recentEvents.length === 0 ? (
                <div className="text-sm text-[#86909C] py-8 text-center">暂无事件数据</div>
              ) : recentEvents.map((event, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  {eventIcon(event.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[#4E5969] leading-relaxed">{event.message}</p>
                    <p className="text-[11px] text-[#86909C] mt-0.5">{event.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Node Distribution + Deployment Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-[#E5E6EB] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1D2129]">节点分布</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <div className="w-[200px] h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={nodeStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {nodeStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="ml-6 space-y-2">
              {nodeStatus.length === 0 ? (
                <span className="text-sm text-[#86909C]">暂无节点数据</span>
              ) : nodeStatus.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-[#4E5969]">{item.name}</span>
                  <span className="text-sm font-medium text-[#1D2129]">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E5E6EB] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1D2129]">部署分布</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <div className="w-[200px] h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deploymentStatus}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {deploymentStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="ml-6 space-y-2">
              {deploymentStatus.length === 0 ? (
                <span className="text-sm text-[#86909C]">暂无部署数据</span>
              ) : deploymentStatus.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-[#4E5969]">{item.name}</span>
                  <span className="text-sm font-medium text-[#1D2129]">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Access Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="border-[#E5E6EB] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1D2129]">节点概览</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {nodes.slice(0, 3).map((node) => (
                <div key={node.name} className="flex items-center justify-between p-3 rounded-lg bg-[#F7F8FA]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-[#E8F3FF] flex items-center justify-center">
                      <Server className="w-4 h-4 text-[#165DFF]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1D2129]">{node.name}</p>
                      <p className="text-xs text-[#86909C]">{node.role === "cloud" ? "云端" : "边缘"} · {node.internalIP}</p>
                    </div>
                  </div>
                  <StatusBadge status={node.status} color={node.status === "Ready" ? "success" : "warning"} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#E5E6EB] shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#1D2129]">部署概览</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {deployments.slice(0, 3).map((dep) => (
                <div key={dep.name} className="flex items-center justify-between p-3 rounded-lg bg-[#F7F8FA]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-[#E8FFEA] flex items-center justify-center">
                      <Boxes className="w-4 h-4 text-[#00B42A]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1D2129]">{dep.name}</p>
                      <p className="text-xs text-[#86909C]">{dep.namespace} · {dep.ready} Pods</p>
                    </div>
                  </div>
                  <StatusBadge status={dep.availableReplicas > 0 ? "运行中" : "未就绪"} color={dep.availableReplicas > 0 ? "success" : "warning"} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
