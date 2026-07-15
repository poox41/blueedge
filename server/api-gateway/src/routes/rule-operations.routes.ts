import type { Express } from "express";
import { getRuleAudit, getRuleDelivery, getRuleEvents } from "../services/rule-operations.service.js";

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "rule operation failed";
  if (/not found|404/i.test(message)) return 404;
  return 502;
}

export function registerRuleOperationsRoutes(app: Express) {
  app.get("/blueedge/rules/:namespace/:name/delivery", async (req, res) => {
    try {
      res.json(await getRuleDelivery(req.params.namespace, req.params.name));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to read Rule delivery status" });
    }
  });

  app.get("/blueedge/rules/:namespace/:name/events", async (req, res) => {
    try {
      res.json(await getRuleEvents(req.params.namespace, req.params.name));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to read Rule events" });
    }
  });

  app.get("/blueedge/rules/:namespace/:name/audit", async (req, res) => {
    try {
      res.json(await getRuleAudit(req.params.namespace, req.params.name));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to read Rule managed fields" });
    }
  });
}
