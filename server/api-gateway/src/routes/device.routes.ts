import type express from "express";
import {
  getDeviceModelSummary,
  getDeviceSummary,
  listDeviceModelSummaries,
  listDeviceSummaries,
} from "../services/device.service.js";

export function registerDeviceRoutes(app: express.Express) {
  app.get("/blueedge/devicemodels/summary", async (req, res) => {
    try {
      const namespace = typeof req.query.namespace === "string" && req.query.namespace !== "all" ? req.query.namespace : undefined;
      res.json(await listDeviceModelSummaries(namespace));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "devicemodel summary API is unavailable" });
    }
  });

  app.get("/blueedge/devicemodels/:namespace/:name/summary", async (req, res) => {
    try {
      res.json(await getDeviceModelSummary(req.params.namespace, req.params.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "devicemodel summary API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });

  app.get("/blueedge/devices/summary", async (req, res) => {
    try {
      const namespace = typeof req.query.namespace === "string" && req.query.namespace !== "all" ? req.query.namespace : undefined;
      const nodeName = typeof req.query.nodeName === "string" ? req.query.nodeName : "";
      const edgeUnit = typeof req.query.edgeUnit === "string" ? req.query.edgeUnit : "";
      const deviceModel = typeof req.query.deviceModel === "string" ? req.query.deviceModel : "";
      res.json(await listDeviceSummaries({ namespace, nodeName, edgeUnit, deviceModel }));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "device summary API is unavailable" });
    }
  });

  app.get("/blueedge/devices/:namespace/:name/summary", async (req, res) => {
    try {
      res.json(await getDeviceSummary(req.params.namespace, req.params.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "device summary API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });
}

