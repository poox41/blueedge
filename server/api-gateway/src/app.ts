import cors from "cors";
import express, { type Express } from "express";
import { config } from "./config.js";
import { rejectServiceIdentity, requireAuth } from "./middleware/auth.middleware.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { notFoundMiddleware } from "./middleware/not-found.middleware.js";
import { registerAccessConfigRoutes } from "./routes/access-config.routes.js";
import { registerPublicAuthRoutes } from "./routes/auth.routes.js";
import { registerBatchTaskRoutes } from "./routes/batch-task.routes.js";
import { registerClusterRoutes } from "./routes/cluster.routes.js";
import { registerDeviceRoutes } from "./routes/device.routes.js";
import { registerDeploymentOperationsRoutes } from "./routes/deployment-operations.routes.js";
import { registerEdgeUnitRoutes } from "./routes/edge-unit.routes.js";
import { registerEdgeApplicationProxyRoutes } from "./routes/edgeapplication-proxy.routes.js";
import { registerEventsRoutes } from "./routes/events.routes.js";
import { registerMetricsRoutes } from "./routes/metrics.routes.js";
import { registerModelRegistryRoutes } from "./routes/model-registry.routes.js";
import { registerModelDeploymentRoutes } from "./routes/model-deployment.routes.js";
import { registerObservabilityRoutes } from "./routes/observability.routes.js";
import { registerOverviewRoutes } from "./routes/overview.routes.js";
import { registerProxyRoutes } from "./routes/proxy.routes.js";
import { registerResourceSummaryRoutes } from "./routes/resource-summary.routes.js";
import { registerRuleOperationsRoutes } from "./routes/rule-operations.routes.js";
import { registerStorageCrudRoutes } from "./routes/storage-crud.routes.js";
import { registerStorageRoutes } from "./routes/storage.routes.js";
import { registerWorkloadRoutes } from "./routes/workload.routes.js";

export function createApp(): Express {
  const app = express();

  if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || !config.corsAllowedOrigins.includes(origin)) {
        callback(null, false);
        return;
      }
      callback(null, origin);
    },
  }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "blueedge-api-gateway" });
  });

  registerPublicAuthRoutes(app);

  app.use(requireAuth);

  // Machine identities are allow-listed by route and scope. Register their
  // dedicated API before rejecting them from all interactive/admin APIs.
  registerModelDeploymentRoutes(app);
  app.use(rejectServiceIdentity);

  registerEdgeUnitRoutes(app);
  registerAccessConfigRoutes(app);
  registerBatchTaskRoutes(app);
  registerClusterRoutes(app);
  registerDeviceRoutes(app);
  registerDeploymentOperationsRoutes(app);
  registerObservabilityRoutes(app);
  registerResourceSummaryRoutes(app);
  registerRuleOperationsRoutes(app);
  registerMetricsRoutes(app);
  registerModelRegistryRoutes(app);
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
