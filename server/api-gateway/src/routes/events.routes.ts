import type { Express } from "express";
import { getLegacyEvents } from "../services/events.service.js";

export function registerEventsRoutes(app: Express) {
  app.get("/events", async (req, res) => {
    try {
      const namespace = typeof req.query.namespace === "string" ? req.query.namespace : "";
      res.json(await getLegacyEvents(namespace));
    } catch (error) {
      res.status(503).json({ message: error instanceof Error ? error.message : "events API is unavailable" });
    }
  });
}
