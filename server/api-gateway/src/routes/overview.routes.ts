import type { Express } from "express";
import { getLegacyOverview } from "../services/overview.service.js";

export function registerOverviewRoutes(app: Express) {
  app.get("/overview", async (_req, res) => {
    try {
      res.json(await getLegacyOverview());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "unknown error" });
    }
  });
}
