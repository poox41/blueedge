import type express from "express";
import {
  getPersistentVolumeClaimSummary,
  getPersistentVolumeSummary,
  listPersistentVolumeClaimSummaries,
  listPersistentVolumeSummaries,
  listStorageClasses,
} from "../services/storage.service.js";

export function registerStorageRoutes(app: express.Express) {
  app.get("/blueedge/storage/classes", async (_req, res) => {
    try {
      res.json(await listStorageClasses());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "storage classes API is unavailable" });
    }
  });

  app.get("/blueedge/storage/persistentvolumes/summary", async (_req, res) => {
    try {
      res.json(await listPersistentVolumeSummaries());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "PV summary API is unavailable" });
    }
  });

  app.get("/blueedge/storage/persistentvolumes/:name/summary", async (req, res) => {
    try {
      res.json(await getPersistentVolumeSummary(req.params.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "PV summary API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });

  app.get("/blueedge/storage/persistentvolumeclaims/summary", async (req, res) => {
    try {
      const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
      res.json(await listPersistentVolumeClaimSummaries(namespace));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "PVC summary API is unavailable" });
    }
  });

  app.get("/blueedge/storage/persistentvolumeclaims/:namespace/:name/summary", async (req, res) => {
    try {
      res.json(await getPersistentVolumeClaimSummary(req.params.namespace, req.params.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "PVC summary API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });
}
