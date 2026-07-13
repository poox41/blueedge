import type { Express } from "express";
import { proxyBffRequest } from "../clients/bff-client.js";

export function registerProxyRoutes(app: Express) {
  app.use("/bff", async (req, res) => {
    try {
      await proxyBffRequest(req, res);
    } catch (error) {
      res.status(502).json({ message: error instanceof Error ? error.message : "BFF proxy failed" });
    }
  });
}
