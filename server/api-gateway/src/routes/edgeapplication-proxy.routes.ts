import type { Express } from "express";
import { createEdgeApplication, updateEdgeApplication } from "../services/edgeapplication-proxy.service.js";

export function registerEdgeApplicationProxyRoutes(app: Express) {
  app.post("/bff/edgeapplication/:namespace", async (req, res) => {
    try {
      const result = await createEdgeApplication(req.params.namespace, req.body);
      res.status(result.status).json(result.data);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edgeapplication create failed" });
    }
  });
  app.put("/bff/edgeapplication/:namespace", async (req, res) => {
    try {
      const result = await updateEdgeApplication(req.params.namespace, req.body);
      res.status(result.status).json(result.data);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edgeapplication update failed" });
    }
  });
}
