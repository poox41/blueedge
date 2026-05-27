import cors from "cors";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const port = Number(process.env.PORT || 7001);
const bffBaseUrl = process.env.BFF_BASE_URL || "http://127.0.0.1:8080/api/v1";
const k8sApiServer = process.env.K8S_API_SERVER || "";

if (process.env.K8S_SKIP_TLS_VERIFY === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));

async function getJson(path: string, authorization?: string) {
  const response = await fetch(`${bffBaseUrl}${path}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });

  if (!response.ok) {
    throw new Error(`BFF request ${path} failed: ${response.status}`);
  }

  return response.json();
}

async function getK8sJson(path: string, authorization?: string) {
  if (!k8sApiServer) {
    throw new Error("K8S_API_SERVER is not configured");
  }

  const response = await fetch(`${k8sApiServer}${path}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });

  if (!response.ok) {
    throw new Error(`Kubernetes request ${path} failed: ${response.status}`);
  }

  return response.json();
}

function itemsOf(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function parseCpuToMillicores(value: unknown): number {
  if (typeof value !== "string") return 0;
  if (value.endsWith("n")) return Number(value.slice(0, -1)) / 1_000_000;
  if (value.endsWith("u")) return Number(value.slice(0, -1)) / 1_000;
  if (value.endsWith("m")) return Number(value.slice(0, -1));
  return Number(value) * 1000;
}

function parseMemoryToBytes(value: unknown): number {
  if (typeof value !== "string") return 0;
  const match = value.match(/^([0-9.]+)([A-Za-z]*)$/);
  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = match[2];
  const factors: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    "": 1,
  };
  return amount * (factors[unit] || 1);
}

function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.round((used / total) * 1000) / 10;
}

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "blueedge-api-gateway" });
});

app.get("/overview", async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    const [nodesRaw, deploymentsRaw, devicesRaw, rulesRaw] = await Promise.allSettled([
      getJson("/node", authorization),
      getJson("/deployment", authorization),
      getJson("/device", authorization),
      getJson("/rule", authorization),
    ]);

    const nodes = nodesRaw.status === "fulfilled" ? itemsOf(nodesRaw.value) : [];
    const deployments = deploymentsRaw.status === "fulfilled" ? itemsOf(deploymentsRaw.value) : [];
    const devices = devicesRaw.status === "fulfilled" ? itemsOf(devicesRaw.value) : [];
    const rules = rulesRaw.status === "fulfilled" ? itemsOf(rulesRaw.value) : [];

    const readyNodes = nodes.filter((node) => {
      const conditions = node?.status?.conditions || [];
      return conditions.some((item: any) => item.type === "Ready" && item.status === "True");
    });

    const edgeNodes = nodes.filter((node) => {
      const labels = node?.metadata?.labels || {};
      return Object.keys(labels).some((key) => key.includes("edge") || key.includes("kubeedge"));
    });

    const runningDeployments = deployments.filter((item) => {
      return Number(item?.status?.availableReplicas || 0) > 0;
    });

    res.json({
      nodes: { total: nodes.length, ready: readyNodes.length, edge: edgeNodes.length },
      workloads: { deployments: deployments.length, running: runningDeployments.length },
      devices: { total: devices.length, online: 0 },
      rules: { total: rules.length },
    });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.get("/storage/persistentvolumes", async (req, res) => {
  try {
    const data = await getK8sJson("/api/v1/persistentvolumes", req.headers.authorization);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.get("/storage/persistentvolumeclaims", async (req, res) => {
  try {
    const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
    const path = namespace
      ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`
      : "/api/v1/persistentvolumeclaims";
    const data = await getK8sJson(path, req.headers.authorization);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.get("/metrics/cluster", async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    const [metricsRaw, nodesRaw] = await Promise.all([
      getK8sJson("/apis/metrics.k8s.io/v1beta1/nodes", authorization),
      getK8sJson("/api/v1/nodes", authorization),
    ]);

    const metricItems = itemsOf(metricsRaw);
    const nodeItems = itemsOf(nodesRaw);

    const cpuUsedMillicores = metricItems.reduce((sum, item) => sum + parseCpuToMillicores(item?.usage?.cpu), 0);
    const memoryUsedBytes = metricItems.reduce((sum, item) => sum + parseMemoryToBytes(item?.usage?.memory), 0);
    const cpuCapacityMillicores = nodeItems.reduce((sum, item) => sum + parseCpuToMillicores(item?.status?.capacity?.cpu), 0);
    const memoryCapacityBytes = nodeItems.reduce((sum, item) => sum + parseMemoryToBytes(item?.status?.capacity?.memory), 0);

    res.json({
      cpu: {
        usedMillicores: Math.round(cpuUsedMillicores),
        capacityMillicores: Math.round(cpuCapacityMillicores),
        percent: percent(cpuUsedMillicores, cpuCapacityMillicores),
      },
      memory: {
        usedBytes: Math.round(memoryUsedBytes),
        capacityBytes: Math.round(memoryCapacityBytes),
        percent: percent(memoryUsedBytes, memoryCapacityBytes),
      },
      source: "metrics.k8s.io/v1beta1",
    });
  } catch (error) {
    res.status(503).json({ message: error instanceof Error ? error.message : "metrics API is unavailable" });
  }
});

app.get("/metrics/nodes", async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    const [metricsRaw, nodesRaw] = await Promise.all([
      getK8sJson("/apis/metrics.k8s.io/v1beta1/nodes", authorization),
      getK8sJson("/api/v1/nodes", authorization),
    ]);
    const metricItems = itemsOf(metricsRaw);
    const nodeItems = itemsOf(nodesRaw);
    const capacityByName = new Map(
      nodeItems.map((node) => [
        node?.metadata?.name,
        {
          cpuMillicores: parseCpuToMillicores(node?.status?.capacity?.cpu),
          memoryBytes: parseMemoryToBytes(node?.status?.capacity?.memory),
        },
      ]),
    );

    res.json({
      items: metricItems.map((item) => {
        const name = item?.metadata?.name || item?.name;
        const capacity = capacityByName.get(name) || { cpuMillicores: 0, memoryBytes: 0 };
        const cpuMillicores = parseCpuToMillicores(item?.usage?.cpu);
        const memoryBytes = parseMemoryToBytes(item?.usage?.memory);
        return {
          name,
          cpuMillicores: Math.round(cpuMillicores),
          memoryBytes: Math.round(memoryBytes),
          cpuPercent: percent(cpuMillicores, capacity.cpuMillicores),
          memoryPercent: percent(memoryBytes, capacity.memoryBytes),
        };
      }),
    });
  } catch (error) {
    res.status(503).json({ message: error instanceof Error ? error.message : "node metrics API is unavailable" });
  }
});

app.get("/metrics/pods", async (req, res) => {
  try {
    const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
    const path = namespace
      ? `/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/pods`
      : "/apis/metrics.k8s.io/v1beta1/pods";
    const data = await getK8sJson(path, req.headers.authorization);
    res.json({
      items: itemsOf(data).map((item) => {
        const containers = Array.isArray(item?.containers) ? item.containers : [];
        const cpuMillicores = containers.reduce((sum: number, container: any) => sum + parseCpuToMillicores(container?.usage?.cpu), 0);
        const memoryBytes = containers.reduce((sum: number, container: any) => sum + parseMemoryToBytes(container?.usage?.memory), 0);
        return {
          name: item?.metadata?.name || item?.name,
          namespace: item?.metadata?.namespace || item?.namespace,
          cpuMillicores: Math.round(cpuMillicores),
          memoryBytes: Math.round(memoryBytes),
        };
      }),
    });
  } catch (error) {
    res.status(503).json({ message: error instanceof Error ? error.message : "pod metrics API is unavailable" });
  }
});

app.use("/bff", createProxyMiddleware({ target: bffBaseUrl, changeOrigin: true, pathRewrite: { "^/bff": "" } }));

app.listen(port, () => {
  console.log(`BlueEdge api-gateway listening on http://127.0.0.1:${port}`);
  console.log(`BFF base URL: ${bffBaseUrl}`);
  if (k8sApiServer) console.log(`Kubernetes API server: ${k8sApiServer}`);
});
