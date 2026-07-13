import type { Express } from "express";
import { getLegacyPodLogs, listLegacyPods } from "../services/workload.service.js";

export function registerWorkloadRoutes(app: Express) {
  app.get("/workloads/pods", async (req, res) => {
    try {
      const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
      res.json(await listLegacyPods(namespace));
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "pod API is unavailable" });
    }
  });

  app.get("/workloads/pods/:namespace/:name/logs", async (req, res) => {
    try {
      const tailLines = typeof req.query.tailLines === "string" ? req.query.tailLines : "200";
      const data = await getLegacyPodLogs(req.params.namespace, req.params.name, tailLines);
      res.type("text/plain").send(data);
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "pod logs API is unavailable" });
    }
  });
}
