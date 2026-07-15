import type express from "express";
import {
  getDeviceModelSummary,
  getDeviceSummary,
  listDeviceModelSummaries,
  listDeviceSummaries,
} from "../services/device.service.js";
import {
  createDeviceConfig,
  deleteDeviceConfig,
  updateDeviceConfig,
} from "../services/device-config.service.js";
import { DeviceConfigError } from "../utils/device-config.js";

function sendDeviceError(res: express.Response, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = error instanceof DeviceConfigError
    ? error.status
    : message.includes("failed: 404")
      ? 404
      : message.includes("failed: 409")
        ? 409
        : 500;
  res.status(status).json({ message });
}

export function registerDeviceRoutes(app: express.Express) {
  app.post("/blueedge/devices", async (req, res) => {
    try {
      const input = req.body;
      await createDeviceConfig(input);
      res.status(201).json(await getDeviceSummary(input.namespace, input.name));
    } catch (error) {
      sendDeviceError(res, error, "device create API is unavailable");
    }
  });

  app.put("/blueedge/devices/:namespace/:name", async (req, res) => {
    try {
      await updateDeviceConfig(req.params.namespace, req.params.name, req.body);
      res.json(await getDeviceSummary(req.params.namespace, req.params.name));
    } catch (error) {
      sendDeviceError(res, error, "device update API is unavailable");
    }
  });

  app.delete("/blueedge/devices/:namespace/:name", async (req, res) => {
    try {
      await deleteDeviceConfig(req.params.namespace, req.params.name);
      res.status(204).send();
    } catch (error) {
      sendDeviceError(res, error, "device delete API is unavailable");
    }
  });

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
