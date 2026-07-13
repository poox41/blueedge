import type { Express } from "express";
import {
  createPersistentVolume,
  createPersistentVolumeClaim,
  deletePersistentVolume,
  deletePersistentVolumeClaim,
  listPersistentVolumeClaims,
  listPersistentVolumes,
} from "../services/storage-crud.service.js";

export function registerStorageCrudRoutes(app: Express) {
  app.get("/storage/persistentvolumes", async (_req, res) => {
    try {
      res.json(await listPersistentVolumes());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
    }
  });
  app.post("/storage/persistentvolumes", async (req, res) => {
    try {
      res.status(201).json(await createPersistentVolume(req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
    }
  });
  app.delete("/storage/persistentvolumes/:name", async (req, res) => {
    try {
      await deletePersistentVolume(req.params.name);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
    }
  });
  app.get("/storage/persistentvolumeclaims", async (req, res) => {
    try {
      const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
      res.json(await listPersistentVolumeClaims(namespace));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
    }
  });
  app.post("/storage/persistentvolumeclaims", async (req, res) => {
    try {
      res.status(201).json(await createPersistentVolumeClaim(req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
    }
  });
  app.delete("/storage/persistentvolumeclaims/:namespace/:name", async (req, res) => {
    try {
      await deletePersistentVolumeClaim(req.params.namespace, req.params.name);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
    }
  });
}
