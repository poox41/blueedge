import cors from "cors";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";

const app = express();
const port = Number(process.env.PORT || 7001);
const bffBaseUrl = process.env.BFF_BASE_URL || "http://127.0.0.1:8080/api/v1";
const k8sApiServer = process.env.K8S_API_SERVER || "";
const adminUsername = process.env.ADMIN_USERNAME || "2026@bluedot";
const adminPassword = process.env.ADMIN_PASSWORD || "2026@bluedot";
const jwtSecret = process.env.JWT_SECRET || "blueedge-dev-secret";
const jwtExpiresInSeconds = parseDurationSeconds(process.env.JWT_EXPIRES_IN || "24h");
const clusterMetricsHistory: ClusterMetricsSample[] = [];
const metricsHistoryMaxAgeMs = 6 * 60 * 60 * 1000;
const metricsHistoryMaxSamples = 120;
const defaultEdgeApplicationTargetNodeGroups = [{ name: "edge-group" }];

if (process.env.K8S_SKIP_TLS_VERIFY === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));

interface ClusterMetricsSample {
  timestamp: string;
  cpu: {
    usedMillicores: number;
    capacityMillicores: number;
    percent: number;
  };
  memory: {
    usedBytes: number;
    capacityBytes: number;
    percent: number;
  };
  source: string;
}

interface JwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

function parseDurationSeconds(value: string): number {
  const match = value.match(/^(\d+)([smhd])?$/);
  if (!match) return 24 * 60 * 60;

  const amount = Number(match[1]);
  const unit = match[2] || "s";
  const factors: Record<string, number> = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 };
  return amount * factors[unit];
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function signJwt(payload: JwtPayload): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = crypto
    .createHmac("sha256", jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as JwtPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractBearerToken(authorization?: string): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token || !verifyJwt(token)) {
    res.status(401).json({ message: "unauthorized" });
    return;
  }
  next();
}

function readTokenFile(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function getServerK8sAuthorization(): string | undefined {
  if (process.env.K8S_AUTH_HEADER) return process.env.K8S_AUTH_HEADER;
  if (process.env.K8S_TOKEN) return `Bearer ${process.env.K8S_TOKEN}`;

  const tokenFile =
    process.env.K8S_TOKEN_FILE ||
    (fs.existsSync("/var/run/secrets/kubernetes.io/serviceaccount/token")
      ? "/var/run/secrets/kubernetes.io/serviceaccount/token"
      : "");
  const token = tokenFile ? readTokenFile(tokenFile) : null;
  return token ? `Bearer ${token}` : undefined;
}

function hasServerK8sAuthorization(): boolean {
  return Boolean(getServerK8sAuthorization());
}

async function getJson(path: string) {
  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${bffBaseUrl}${path}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });

  if (!response.ok) {
    throw new Error(`BFF request ${path} failed: ${response.status}`);
  }

  return response.json();
}

async function requestBffJson(path: string, options: { method?: string; body?: unknown } = {}) {
  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${bffBaseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const message = typeof data === "object" && data && "message" in data
      ? String((data as { message?: unknown }).message)
      : typeof data === "string" && data
        ? data
        : `BFF request ${path} failed: ${response.status}`;
    throw new Error(message);
  }

  return { data, status: response.status };
}

async function requestK8sJson(path: string, options: { method?: string; body?: unknown } = {}) {
  if (!k8sApiServer) {
    throw new Error("K8S_API_SERVER is not configured");
  }

  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${k8sApiServer}${path}`, {
    method: options.method || "GET",
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Kubernetes request ${path} failed: ${response.status}${message ? ` ${message}` : ""}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getK8sJson(path: string) {
  return requestK8sJson(path);
}

async function getK8sText(path: string) {
  if (!k8sApiServer) {
    throw new Error("K8S_API_SERVER is not configured");
  }

  const authorization = getServerK8sAuthorization();
  const response = await fetch(`${k8sApiServer}${path}`, {
    headers: authorization ? { Authorization: authorization } : {},
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`Kubernetes request ${path} failed: ${response.status}${text ? ` ${text}` : ""}`);
  }
  return text;
}

function itemsOf(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function withEdgeApplicationWorkloadScope(payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;

  return {
    ...payload,
    spec: {
      ...(payload.spec || {}),
      workloadScope: {
        ...(payload.spec?.workloadScope || {}),
        targetNodeGroups: Array.isArray(payload.spec?.workloadScope?.targetNodeGroups) &&
          payload.spec.workloadScope.targetNodeGroups.length > 0
          ? payload.spec.workloadScope.targetNodeGroups
          : defaultEdgeApplicationTargetNodeGroups,
      },
    },
  };
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

async function collectClusterMetrics(): Promise<ClusterMetricsSample> {
  const [metricsRaw, nodesRaw] = await Promise.all([
    getK8sJson("/apis/metrics.k8s.io/v1beta1/nodes"),
    getK8sJson("/api/v1/nodes"),
  ]);

  const metricItems = itemsOf(metricsRaw);
  const nodeItems = itemsOf(nodesRaw);

  const cpuUsedMillicores = metricItems.reduce((sum, item) => sum + parseCpuToMillicores(item?.usage?.cpu), 0);
  const memoryUsedBytes = metricItems.reduce((sum, item) => sum + parseMemoryToBytes(item?.usage?.memory), 0);
  const cpuCapacityMillicores = nodeItems.reduce((sum, item) => sum + parseCpuToMillicores(item?.status?.capacity?.cpu), 0);
  const memoryCapacityBytes = nodeItems.reduce((sum, item) => sum + parseMemoryToBytes(item?.status?.capacity?.memory), 0);

  return {
    timestamp: new Date().toISOString(),
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
  };
}

function rememberClusterMetrics(sample: ClusterMetricsSample) {
  const last = clusterMetricsHistory[clusterMetricsHistory.length - 1];
  if (!last || new Date(sample.timestamp).getTime() - new Date(last.timestamp).getTime() >= 15_000) {
    clusterMetricsHistory.push(sample);
  } else {
    clusterMetricsHistory[clusterMetricsHistory.length - 1] = sample;
  }

  const minTimestamp = Date.now() - metricsHistoryMaxAgeMs;
  while (
    clusterMetricsHistory.length > metricsHistoryMaxSamples ||
    (clusterMetricsHistory[0] && new Date(clusterMetricsHistory[0].timestamp).getTime() < minTimestamp)
  ) {
    clusterMetricsHistory.shift();
  }
}

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "blueedge-api-gateway" });
});

app.post("/auth/login", (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (username !== adminUsername || password !== adminPassword) {
    res.status(401).json({ message: "账号或密码错误" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({
    sub: username,
    username,
    iat: now,
    exp: now + jwtExpiresInSeconds,
  });
  res.json({ token });
});

app.use(requireAuth);

app.get("/overview", async (req, res) => {
  try {
    const [nodesRaw, deploymentsRaw, devicesRaw, rulesRaw] = await Promise.allSettled([
      getJson("/node"),
      getJson("/deployment"),
      getJson("/device"),
      getJson("/rule"),
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
    const data = await getK8sJson("/api/v1/persistentvolumes");
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.post("/storage/persistentvolumes", async (req, res) => {
  try {
    const data = await requestK8sJson("/api/v1/persistentvolumes", {
      method: "POST",
      body: req.body,
    });
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.delete("/storage/persistentvolumes/:name", async (req, res) => {
  try {
    await requestK8sJson(`/api/v1/persistentvolumes/${encodeURIComponent(req.params.name)}`, {
      method: "DELETE",
    });
    res.status(204).end();
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
    const data = await getK8sJson(path);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.post("/storage/persistentvolumeclaims", async (req, res) => {
  try {
    const namespace = req.body?.metadata?.namespace || "default";
    const data = await requestK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`, {
      method: "POST",
      body: req.body,
    });
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.delete("/storage/persistentvolumeclaims/:namespace/:name", async (req, res) => {
  try {
    await requestK8sJson(
      `/api/v1/namespaces/${encodeURIComponent(req.params.namespace)}/persistentvolumeclaims/${encodeURIComponent(req.params.name)}`,
      {
        method: "DELETE",
      },
    );
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
  }
});

app.get("/metrics/cluster", async (req, res) => {
  try {
    const sample = await collectClusterMetrics();
    rememberClusterMetrics(sample);
    res.json(sample);
  } catch (error) {
    res.status(503).json({ message: error instanceof Error ? error.message : "metrics API is unavailable" });
  }
});

app.get("/metrics/cluster/history", async (req, res) => {
  try {
    const sample = await collectClusterMetrics();
    rememberClusterMetrics(sample);
    res.json({
      items: clusterMetricsHistory,
      source: sample.source,
      retention: {
        maxAgeSeconds: Math.round(metricsHistoryMaxAgeMs / 1000),
        maxSamples: metricsHistoryMaxSamples,
      },
    });
  } catch (error) {
    if (clusterMetricsHistory.length > 0) {
      res.json({
        items: clusterMetricsHistory,
        source: clusterMetricsHistory[clusterMetricsHistory.length - 1].source,
        stale: true,
      });
      return;
    }
    res.status(503).json({ message: error instanceof Error ? error.message : "metrics history API is unavailable" });
  }
});

app.get("/events", async (req, res) => {
  try {
    const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
    const path = namespace
      ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/events`
      : "/api/v1/events";
    const data = await getK8sJson(path);
    const events = itemsOf(data)
      .map((item) => ({
        name: item?.metadata?.name || item?.name || "-",
        namespace: item?.metadata?.namespace || item?.namespace || "default",
        type: item?.type || "Normal",
        reason: item?.reason || "-",
        message: item?.message || "",
        involvedObject: {
          kind: item?.involvedObject?.kind || "-",
          name: item?.involvedObject?.name || "-",
        },
        count: item?.count || 1,
        lastTimestamp: item?.lastTimestamp || item?.eventTime || item?.metadata?.creationTimestamp || "",
      }))
      .sort((a, b) => String(b.lastTimestamp).localeCompare(String(a.lastTimestamp)))
      .slice(0, 20);
    res.json({ items: events });
  } catch (error) {
    res.status(503).json({ message: error instanceof Error ? error.message : "events API is unavailable" });
  }
});

app.get("/metrics/nodes", async (req, res) => {
  try {
    const [metricsRaw, nodesRaw] = await Promise.all([
      getK8sJson("/apis/metrics.k8s.io/v1beta1/nodes"),
      getK8sJson("/api/v1/nodes"),
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
    const data = await getK8sJson(path);
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

app.get("/workloads/pods", async (req, res) => {
  try {
    const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
    const path = namespace
      ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`
      : "/api/v1/pods";
    const data = await getK8sJson(path);
    res.json(data);
  } catch (error) {
    res.status(503).json({ message: error instanceof Error ? error.message : "pod API is unavailable" });
  }
});

app.get("/workloads/pods/:namespace/:name/logs", async (req, res) => {
  try {
    const tailLines = typeof req.query.tailLines === "string" ? req.query.tailLines : "200";
    const path =
      `/api/v1/namespaces/${encodeURIComponent(req.params.namespace)}` +
      `/pods/${encodeURIComponent(req.params.name)}/log?tailLines=${encodeURIComponent(tailLines)}&timestamps=true`;
    const data = await getK8sText(path);
    res.type("text/plain").send(data);
  } catch (error) {
    res.status(503).json({ message: error instanceof Error ? error.message : "pod logs API is unavailable" });
  }
});

app.post("/bff/edgeapplication/:namespace", async (req, res) => {
  try {
    const result = await requestBffJson(`/edgeapplication/${encodeURIComponent(req.params.namespace)}`, {
      method: "POST",
      body: withEdgeApplicationWorkloadScope(req.body),
    });
    res.status(result.status).json(result.data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "edgeapplication create failed" });
  }
});

app.put("/bff/edgeapplication/:namespace", async (req, res) => {
  try {
    const result = await requestBffJson(`/edgeapplication/${encodeURIComponent(req.params.namespace)}`, {
      method: "PUT",
      body: withEdgeApplicationWorkloadScope(req.body),
    });
    res.status(result.status).json(result.data);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "edgeapplication update failed" });
  }
});

app.use("/bff", async (req, res) => {
  try {
    const authorization = getServerK8sAuthorization();
    const response = await fetch(`${bffBaseUrl}${req.url}`, {
      method: req.method,
      headers: {
        ...(authorization ? { Authorization: authorization } : {}),
        ...(req.body === undefined || req.method === "GET" || req.method === "HEAD"
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        req.body === undefined || req.method === "GET" || req.method === "HEAD"
          ? undefined
          : JSON.stringify(req.body),
    });

    const contentType = response.headers.get("content-type");
    if (contentType) res.type(contentType);
    res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.status(502).json({ message: error instanceof Error ? error.message : "BFF proxy failed" });
  }
});

app.listen(port, () => {
  console.log(`BlueEdge api-gateway listening on http://127.0.0.1:${port}`);
  console.log(`BFF base URL: ${bffBaseUrl}`);
  if (k8sApiServer) console.log(`Kubernetes API server: ${k8sApiServer}`);
  if (!hasServerK8sAuthorization()) {
    console.warn("WARNING: no server-side Kubernetes credential found. Set K8S_TOKEN, K8S_AUTH_HEADER, or K8S_TOKEN_FILE.");
  }
  if (jwtSecret === "blueedge-dev-secret") console.warn("WARNING: JWT_SECRET is using the development default.");
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    console.warn("WARNING: ADMIN_USERNAME/ADMIN_PASSWORD are using development defaults.");
  }
});
