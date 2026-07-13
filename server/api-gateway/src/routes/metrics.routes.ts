import type { Express } from "express";
import { getClusterMetrics, getClusterMetricsHistory, getNodeMetrics, getPodMetrics } from "../services/metrics.service.js";

export function registerMetricsRoutes(app: Express) {
  app.get("/metrics/cluster", async (_req, res) => {
    try {
      res.json(await getClusterMetrics());
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "metrics API is unavailable" });
    }
  });
  app.get("/metrics/cluster/history", async (_req, res) => {
    try {
      const result = await getClusterMetricsHistory();
      res.status(result.status).json(result.body);
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "metrics history API is unavailable" });
    }
  });
  app.get("/metrics/nodes", async (_req, res) => {
    try {
      res.json(await getNodeMetrics());
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "node metrics API is unavailable" });
    }
  });
  app.get("/metrics/pods", async (req, res) => {
    try {
      const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
      res.json(await getPodMetrics(namespace));
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "pod metrics API is unavailable" });
    }
  });
}
