import type express from "express";
import {
  createEdgeUnit,
  deleteEdgeUnit,
  getEdgeUnit,
  listEdgeUnits,
  updateEdgeUnit,
} from "../services/edge-unit.service.js";

function sendServiceResult(res: express.Response, result: { status: number; body: any }) {
  res.status(result.status).json(result.body);
}

export function registerEdgeUnitRoutes(app: express.Express) {
  app.get("/blueedge/edge-units", async (_req, res) => {
    try {
      res.json(await listEdgeUnits());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge units API is unavailable" });
    }
  });

  app.post("/blueedge/edge-units", async (req, res) => {
    try {
      sendServiceResult(res, await createEdgeUnit(req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit create API is unavailable" });
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
      sendServiceResult(res, await deleteEdgeUnit(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "edge unit delete API is unavailable" });
    }
  });
}
