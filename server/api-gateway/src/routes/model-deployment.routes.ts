import type { Express } from "express";
import { requireServiceScopes } from "../middleware/auth.middleware.js";
import {
  getModelDeploymentStatus,
  findModelDeploymentStatus,
  getModelRegistryTarget,
  listModelPublishEdgeUnits,
  listModelPublishNodes,
  ModelDeploymentError,
  publishModelDeployment,
  resolveModelDeployment,
  type ModelPublishRequest,
} from "../services/model-deployment.service.js";

function statusOf(error: unknown): number {
  if (error instanceof ModelDeploymentError) return error.status;
  const message = error instanceof Error ? error.message : "";
  if (/not found|404/i.test(message)) return 404;
  if (/conflict|409|AlreadyExists/i.test(message)) return 409;
  if (/required|invalid|unsupported|explicit non-latest|not Ready|does not belong|not compatible|imagePullSecret|not configured|disabled|Registry CA Secret|Registry read credential Secret/i.test(message)) return 400;
  return 502;
}

function publishPayload(body: any): ModelPublishRequest {
  return {
    source: body?.source,
    spaceId: body?.spaceId,
    modelRepoId: body?.modelRepoId,
    modelVersionId: body?.modelVersionId,
    modelImageId: body?.modelImageId,
    image: body?.image,
    predictFramework: body?.predictFramework,
    runtimeTemplateId: body?.runtimeTemplateId,
    edgeUnit: body?.edgeUnit,
    targetType: body?.targetType,
    targetId: body?.targetId,
  } as ModelPublishRequest;
}

export function registerModelDeploymentRoutes(app: Express) {
  app.get(
    "/blueedge/model-deployments/edge-units/:edgeUnit/registry-target",
    requireServiceScopes("edge-registry:read"),
    async (req, res) => {
      try {
        res.json(await getModelRegistryTarget(req.params.edgeUnit));
      } catch (error) {
        res.status(statusOf(error)).json({ message: error instanceof Error ? error.message : "failed to read EdgeUnit Registry target" });
      }
    },
  );

  app.get(
    "/blueedge/model-deployments/edge-units",
    requireServiceScopes("edge-units:read"),
    async (_req, res) => {
      try {
        res.json(await listModelPublishEdgeUnits());
      } catch (error) {
        res.status(statusOf(error)).json({ message: error instanceof Error ? error.message : "failed to list EdgeUnits" });
      }
    },
  );

  app.get(
    "/blueedge/model-deployments/edge-units/:edgeUnit/nodes",
    requireServiceScopes("edge-units:read", "edge-nodes:read"),
    async (req, res) => {
      try {
        const runtimeTemplateId = typeof req.query.runtimeTemplateId === "string" ? req.query.runtimeTemplateId.trim() : undefined;
        res.json(await listModelPublishNodes(req.params.edgeUnit, runtimeTemplateId));
      } catch (error) {
        res.status(statusOf(error)).json({ message: error instanceof Error ? error.message : "failed to list EdgeUnit nodes" });
      }
    },
  );

  app.post(
    "/blueedge/model-deployments/resolve",
    requireServiceScopes("deployments:read"),
    async (req, res) => {
      try {
        res.json(await resolveModelDeployment(publishPayload(req.body)));
      } catch (error) {
        res.status(statusOf(error)).json({ message: error instanceof Error ? error.message : "model workload resolve failed" });
      }
    },
  );

  app.post(
    "/blueedge/model-deployments/publish",
    requireServiceScopes("model-deployments:publish", "model-images:update"),
    async (req, res) => {
      try {
        const result = await publishModelDeployment(publishPayload(req.body));
        res.status(result.action === "CREATE" && !result.idempotent ? 201 : 200).json(result);
      } catch (error) {
        res.status(statusOf(error)).json({ message: error instanceof Error ? error.message : "model publish failed" });
      }
    },
  );

  app.get(
    "/blueedge/model-deployments/status",
    requireServiceScopes("deployments:read"),
    async (req, res) => {
      const spaceId = typeof req.query.spaceId === "string" ? req.query.spaceId.trim() : "";
      const modelRepoId = typeof req.query.modelRepoId === "string" ? req.query.modelRepoId.trim() : "";
      const edgeUnit = typeof req.query.edgeUnit === "string" ? req.query.edgeUnit.trim() : "";
      const image = typeof req.query.image === "string" ? req.query.image.trim() : "";
      if (!spaceId || !modelRepoId || !edgeUnit || !image) {
        res.status(400).json({ message: "spaceId, modelRepoId, edgeUnit and image are required" });
        return;
      }
      try {
        res.json(await findModelDeploymentStatus(spaceId, modelRepoId, edgeUnit, image));
      } catch (error) {
        res.status(statusOf(error)).json({ message: error instanceof Error ? error.message : "failed to find model Deployment status" });
      }
    },
  );

  app.get(
    "/blueedge/model-deployments/:namespace/:name/status",
    requireServiceScopes("deployments:read"),
    async (req, res) => {
      try {
        res.json(await getModelDeploymentStatus(req.params.namespace, req.params.name));
      } catch (error) {
        res.status(statusOf(error)).json({ message: error instanceof Error ? error.message : "failed to read model Deployment status" });
      }
    },
  );
}
