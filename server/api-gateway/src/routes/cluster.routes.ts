import type express from "express";
import { listConnectedClusters } from "../services/cluster.service.js";

export function registerClusterRoutes(app: express.Express) {
  app.get("/blueedge/clusters", async (_req, res) => {
    try {
      res.json(await listConnectedClusters());
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "cluster API is unavailable" });
    }
  });
}
