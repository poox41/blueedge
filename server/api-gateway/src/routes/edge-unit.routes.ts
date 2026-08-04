import type express from "express";
import {
  createEdgeUnitDeployment,
  enableEdgeUnitIncrementalSync,
  getEdgeUnit,
  getEdgeUnitResources,
  listEdgeUnits,
  updateEdgeUnit,
  updateEdgeUnitDeployment,
} from "../services/edge-unit.service.js";
import { getIncrementalSyncStatus } from "../services/cloudcore-sync.service.js";
import { getEdgeUnitOperation, startCreateEdgeUnit, startDeleteEdgeUnit } from "../services/edge-unit-operation.service.js";

function sendServiceResult(res: express.Response, result: { status: number; body: any }) {
  res.status(result.status).json(result.body);
}

export function registerEdgeUnitRoutes(app: express.Express) {
  app.get("/blueedge/cloudcore/incremental-sync", async (_req, res) => {
    try {
      res.json({ item: await getIncrementalSyncStatus() });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "增量同步状态读取失败" });
    }
  });

  app.put("/blueedge/edge-units/:name/incremental-sync", async (req, res) => {
    try {
      sendServiceResult(res, await enableEdgeUnitIncrementalSync(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "增量同步启用失败" });
    }
  });

  app.get("/blueedge/edge-units", async (_req, res) => {
    try {
      res.json(await listEdgeUnits());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge units API is unavailable" });
    }
  });

  app.post("/blueedge/edge-units", async (req, res) => {
    try {
      sendServiceResult(res, await startCreateEdgeUnit(req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit create API is unavailable" });
    }
  });

  app.get("/blueedge/edge-unit-operations/:id", async (req, res) => {
    try {
      sendServiceResult(res, await getEdgeUnitOperation(req.params.id));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit operation API is unavailable" });
    }
  });

  app.post("/blueedge/edge-units/:name/deployments", async (req, res) => {
    try {
      sendServiceResult(res, await createEdgeUnitDeployment(req.params.name, req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit workload create API is unavailable" });
    }
  });

  app.put("/blueedge/edge-units/:name/deployments/:namespace/:deploymentName", async (req, res) => {
    try {
      sendServiceResult(res, await updateEdgeUnitDeployment(req.params.name, req.params.namespace, req.params.deploymentName, req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit workload update API is unavailable" });
    }
  });

  app.get("/blueedge/edge-units/:name/resources", async (req, res) => {
    try {
      sendServiceResult(res, await getEdgeUnitResources(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit resources API is unavailable" });
    }
  });

  app.get("/blueedge/edge-units/:name", async (req, res) => {
    try {
      sendServiceResult(res, await getEdgeUnit(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit API is unavailable" });
    }
  });

  app.put("/blueedge/edge-units/:name", async (req, res) => {
    try {
      sendServiceResult(res, await updateEdgeUnit(req.params.name, req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit update API is unavailable" });
    }
  });

  app.delete("/blueedge/edge-units/:name", async (req, res) => {
    try {
      sendServiceResult(res, await startDeleteEdgeUnit(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit delete API is unavailable" });
    }
  });
}
