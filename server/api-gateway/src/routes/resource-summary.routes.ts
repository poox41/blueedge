import type { Express } from "express";
import { getPodSummary } from "../services/pod-summary.service.js";
import { getNodeSummary } from "../services/node-summary.service.js";
import { getNodeGroupSummary } from "../services/nodegroup-summary.service.js";
import { getEdgeAppSummary } from "../services/edgeapp-summary.service.js";

export function registerResourceSummaryRoutes(app: Express) {
  app.get("/blueedge/nodes/:name/summary", async (req, res) => {
    try {
      res.json(await getNodeSummary(req.params.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "node summary API is unavailable";
      res.status(message.includes("404") || message === `Node ${req.params.name} not found` ? 404 : 500).json({ message });
    }
  });

  app.get("/blueedge/nodegroups/:name/summary", async (req, res) => {
    try {
      const result = await getNodeGroupSummary(req.params.name);
      if (!result) {
        res.status(404).json({ message: `NodeGroup ${req.params.name} not found` });
        return;
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "nodegroup summary API is unavailable" });
    }
  });

  app.get("/blueedge/edgeapps/:namespace/:name/summary", async (req, res) => {
    try {
      res.json(await getEdgeAppSummary(req.params.namespace, req.params.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "edgeapp summary API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });

  app.get("/blueedge/pods/:namespace/:name/summary", async (req, res) => {
    try {
      res.json(await getPodSummary(req.params.namespace, req.params.name, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "pod summary API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });
}
