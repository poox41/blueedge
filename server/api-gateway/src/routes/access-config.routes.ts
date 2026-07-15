import type express from "express";
import {
  createAccessConfig,
  deleteAccessConfig,
  getAccessConfig,
  getInstallCommand,
  listAccessConfigs,
  updateAccessConfig,
} from "../services/access-config.service.js";

function sendServiceResult(res: express.Response, result: { status: number; body: any }) {
  res.status(result.status).json(result.body);
}

export function registerAccessConfigRoutes(app: express.Express) {
  app.get("/blueedge/access-configs", async (_req, res) => {
    try {
      res.json(await listAccessConfigs());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "access configs API is unavailable" });
    }
  });

  app.get("/blueedge/access-configs/:name", async (req, res) => {
    try {
      sendServiceResult(res, await getAccessConfig(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "access config API is unavailable" });
    }
  });

  app.post("/blueedge/access-configs", async (req, res) => {
    try {
      sendServiceResult(res, await createAccessConfig(req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "access config create API is unavailable" });
    }
  });

  app.put("/blueedge/access-configs/:name", async (req, res) => {
    try {
      sendServiceResult(res, await updateAccessConfig(req.params.name, req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "access config update API is unavailable" });
    }
  });

  app.delete("/blueedge/access-configs/:name", async (req, res) => {
    try {
      sendServiceResult(res, await deleteAccessConfig(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "access config delete API is unavailable" });
    }
  });

  app.get("/blueedge/access-configs/:name/install-command", async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      sendServiceResult(res, await getInstallCommand(req.params.name));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "install command API is unavailable" });
    }
  });

  app.get("/blueedge/access-configs/:name/download", async (_req, res) => {
    res.status(501).json({
      message: "AccessConfig download is not configured. Install package or edgecore config generation is required before this endpoint can return a file.",
    });
  });
}
