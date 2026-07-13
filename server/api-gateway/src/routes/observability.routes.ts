import type express from "express";
import { getObservabilityLogs, getObservabilitySummary, observabilityKinds } from "../services/observability.service.js";
import type { ObservabilityKind } from "../types/observability.js";

function isObservabilityKind(value: string): value is ObservabilityKind {
  return observabilityKinds.has(value);
}

export function registerObservabilityRoutes(app: express.Express) {
  app.get("/blueedge/observability/resources/:kind/:namespace/:name", async (req, res) => {
    try {
      const kind = String(req.params.kind || "").toLowerCase();
      if (!isObservabilityKind(kind)) {
        res.status(400).json({ message: `Unsupported observability kind: ${req.params.kind}` });
        return;
      }
      const namespace = kind === "node" ? "" : req.params.namespace;
      res.json(await getObservabilitySummary(kind, namespace, req.params.name, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "observability API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });

  app.get("/blueedge/observability/resources/:kind/:namespace/:name/logs", async (req, res) => {
    try {
      const kind = String(req.params.kind || "").toLowerCase();
      if (!isObservabilityKind(kind)) {
        res.status(400).json({ message: `Unsupported observability kind: ${req.params.kind}` });
        return;
      }
      const namespace = kind === "node" ? "" : req.params.namespace;
      res.json(await getObservabilityLogs(kind, namespace, req.params.name, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : "observability logs API is unavailable";
      res.status(message.includes("404") ? 404 : 500).json({ message });
    }
  });
}

