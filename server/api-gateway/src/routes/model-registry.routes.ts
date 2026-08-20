import type { Express } from "express";
import {
  edgeUnitRegistryConnection,
  listModelRepositories,
  listModelTags,
  updateModelImage,
} from "../services/model-registry.service.js";
import {
  readEdgeUnitRegistryCa,
  readEdgeUnitRegistryCredential,
  resolveEdgeUnitModelRegistry,
} from "../services/edge-unit-model-registry.service.js";

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "model registry operation failed";
  if (/not found|404/i.test(message)) return 404;
  if (/required|invalid|already in use|changed since|not a configured|Registry CA Secret|Registry read credential Secret/i.test(message)) return 400;
  if (/not configured|未配置/i.test(message)) return 503;
  return 502;
}

export function registerModelRegistryRoutes(app: Express) {
  app.get("/blueedge/model-registry/models", async (req, res) => {
    try {
      const edgeUnit = typeof req.query.edgeUnit === "string" ? req.query.edgeUnit.trim() : "";
      if (!edgeUnit) {
        res.json(await listModelRepositories());
        return;
      }
      const registry = await resolveEdgeUnitModelRegistry(edgeUnit);
      const [credential, ca] = await Promise.all([
        readEdgeUnitRegistryCredential(registry),
        readEdgeUnitRegistryCa(registry),
      ]);
      res.json(await listModelRepositories(edgeUnitRegistryConnection(registry, credential, ca?.pem)));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to list models" });
    }
  });

  app.get("/blueedge/model-registry/tags", async (req, res) => {
    const model = typeof req.query.model === "string" ? req.query.model.trim() : "";
    if (!model) {
      res.status(400).json({ message: "model is required" });
      return;
    }
    try {
      const edgeUnit = typeof req.query.edgeUnit === "string" ? req.query.edgeUnit.trim() : "";
      if (!edgeUnit) {
        res.json(await listModelTags(model));
        return;
      }
      const registry = await resolveEdgeUnitModelRegistry(edgeUnit);
      const [credential, ca] = await Promise.all([
        readEdgeUnitRegistryCredential(registry),
        readEdgeUnitRegistryCa(registry),
      ]);
      res.json(await listModelTags(model, edgeUnitRegistryConnection(registry, credential, ca?.pem)));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to list model tags" });
    }
  });

  app.post("/blueedge/deployments/:namespace/:name/model-image", async (req, res) => {
    const payload = {
      containerName: typeof req.body?.containerName === "string" ? req.body.containerName.trim() : "",
      model: typeof req.body?.model === "string" ? req.body.model.trim() : "",
      tag: typeof req.body?.tag === "string" ? req.body.tag.trim() : "",
      expectedCurrentImage: typeof req.body?.expectedCurrentImage === "string" ? req.body.expectedCurrentImage.trim() : undefined,
    };
    if (!payload.containerName || !payload.model || !payload.tag) {
      res.status(400).json({ message: "containerName, model and tag are required" });
      return;
    }
    try {
      res.json(await updateModelImage(req.params.namespace, req.params.name, payload));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to update model image" });
    }
  });
}
