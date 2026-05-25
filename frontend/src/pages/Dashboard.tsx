import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  systemInfo,
  dashboardStats,
  nodesData,
  deploymentsData,
} from "@/data/mockData";
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

export function Dashboard() {
  const { cpuData, memoryData, nodeStatus, deploymentStatus, recentEvents } = dashboardStats;

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
      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-[#E5E6EB] shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#86909C] mb-1">节点状态</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[#1D2129]">{systemInfo.readyNodes}</span>
                  <span className="text-sm text-[#00B42A]">就绪</span>
                </div>
                {systemInfo.notReadyNodes > 0 && (
                  <p className="text-xs text-[#F53F3F] mt-1">{systemInfo.notReadyNodes} 未就绪</p>
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
                  <span className="text-2xl font-bold text-[#1D2129]">{systemInfo.runningDeployments}</span>
                  <span className="text-sm text-[#00B42A]">运行中</span>
                </div>
                {systemInfo.inactiveDeployments > 0 && (
                  <p className="text-xs text-[#FF7D00] mt-1">{systemInfo.inactiveDeployments} 不活跃</p>
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
                  <span className="text-2xl font-bold text-[#1D2129]">{systemInfo.cpuUsage.percent}%</span>
                  <span className="text-sm text-[#4E5969]">{systemInfo.cpuUsage.value}{systemInfo.cpuUsage.unit}</span>
                </div>
                <div className="w-full h-1.5 bg-[#F2F3F5] rounded-full mt-2">
                  <div
                    className="h-full rounded-full bg-[#165DFF]"
                    style={{ width: `${systemInfo.cpuUsage.percent}%` }}
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
                  <span className="text-2xl font-bold text-[#1D2129]">{systemInfo.memoryUsage.percent}%</span>
                  <span className="text-sm text-[#4E5969]">{systemInfo.memoryUsage.value}{systemInfo.memoryUsage.unit}</span>
                </div>
                <div className="w-full h-1.5 bg-[#F2F3F5] rounded-full mt-2">
                  <div
                    className="h-full rounded-full bg-[#00B42A]"
                    style={{ width: `${systemInfo.memoryUsage.percent}%` }}
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
              <AreaChart data={cpuData}>
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
              <AreaChart data={memoryData}>
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
              {recentEvents.map((event, i) => (
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
              {nodeStatus.map((item, i) => (
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
              {deploymentStatus.map((item, i) => (
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
              {nodesData.slice(0, 2).map((node) => (
                <div key={node.name} className="flex items-center justify-between p-3 rounded-lg bg-[#F7F8FA]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-[#E8F3FF] flex items-center justify-center">
                      <Server className="w-4 h-4 text-[#165DFF]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1D2129]">{node.name}</p>
                      <p className="text-xs text-[#86909C]">{node.role === "cloud" ? "云端" : "边缘"} · {node.ip}</p>
                    </div>
                  </div>
                  <StatusBadge status={node.status} color="success" />
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
              {deploymentsData.slice(0, 3).map((dep) => (
                <div key={dep.name} className="flex items-center justify-between p-3 rounded-lg bg-[#F7F8FA]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-[#E8FFEA] flex items-center justify-center">
                      <Boxes className="w-4 h-4 text-[#00B42A]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1D2129]">{dep.name}</p>
                      <p className="text-xs text-[#86909C]">{dep.namespace} · {dep.pods} Pods</p>
                    </div>
                  </div>
                  <StatusBadge status={dep.status} color="success" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
