import cors from "cors";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const port = Number(process.env.PORT || 7001);
const bffBaseUrl = process.env.BFF_BASE_URL || "http://127.0.0.1:8080/api";

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

function itemsOf(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
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

app.use("/bff", createProxyMiddleware({ target: bffBaseUrl, changeOrigin: true, pathRewrite: { "^/bff": "" } }));

app.listen(port, () => {
  console.log(`BlueEdge api-gateway listening on http://127.0.0.1:${port}`);
  console.log(`BFF base URL: ${bffBaseUrl}`);
});
