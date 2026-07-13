import cors from "cors";
import express, { type Express } from "express";
import { config } from "./config.js";
import { createAuthToken, requireAuth } from "./middleware/auth.middleware.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { notFoundMiddleware } from "./middleware/not-found.middleware.js";
import { registerAccessConfigRoutes } from "./routes/access-config.routes.js";
import { registerBatchTaskRoutes } from "./routes/batch-task.routes.js";
import { registerDeviceRoutes } from "./routes/device.routes.js";
import { registerEdgeUnitRoutes } from "./routes/edge-unit.routes.js";
import { registerEdgeApplicationProxyRoutes } from "./routes/edgeapplication-proxy.routes.js";
import { registerEventsRoutes } from "./routes/events.routes.js";
import { registerMetricsRoutes } from "./routes/metrics.routes.js";
import { registerObservabilityRoutes } from "./routes/observability.routes.js";
import { registerOverviewRoutes } from "./routes/overview.routes.js";
import { registerProxyRoutes } from "./routes/proxy.routes.js";
import { registerResourceSummaryRoutes } from "./routes/resource-summary.routes.js";
import { registerStorageCrudRoutes } from "./routes/storage-crud.routes.js";
import { registerStorageRoutes } from "./routes/storage.routes.js";
import { registerWorkloadRoutes } from "./routes/workload.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "blueedge-api-gateway" });
  });

  app.post("/auth/login", (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (username !== config.adminUsername || password !== config.adminPassword) {
      res.status(401).json({ message: "账号或密码错误" });
      return;
    }
    res.json({ token: createAuthToken(username) });
  });

  app.use(requireAuth);

  registerEdgeUnitRoutes(app);
  registerAccessConfigRoutes(app);
  registerBatchTaskRoutes(app);
  registerDeviceRoutes(app);
  registerObservabilityRoutes(app);
  registerResourceSummaryRoutes(app);
  registerMetricsRoutes(app);
  registerEventsRoutes(app);
  registerWorkloadRoutes(app);
  registerStorageRoutes(app);
  registerStorageCrudRoutes(app);
  registerOverviewRoutes(app);
  registerEdgeApplicationProxyRoutes(app);
  registerProxyRoutes(app);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
