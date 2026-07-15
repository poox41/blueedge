import type { Express } from "express";
import {
  executePodCommand,
  getDeploymentAudit,
  listDeploymentRevisions,
  rollbackDeployment,
  runDeploymentAction,
} from "../services/deployment-operations.service.js";
import type { DeploymentAction } from "../types/deployment-operations.js";

const actions = new Set<DeploymentAction>(["start", "stop", "restart"]);

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "deployment operation failed";
  if (/not found|404/i.test(message)) return 404;
  if (/required|must|invalid|does not belong/i.test(message)) return 400;
  return 502;
}

export function registerDeploymentOperationsRoutes(app: Express) {
  app.get("/blueedge/deployments/:namespace/:name/revisions", async (req, res) => {
    try {
      res.json(await listDeploymentRevisions(req.params.namespace, req.params.name));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to list revisions" });
    }
  });

  app.post("/blueedge/deployments/:namespace/:name/revisions/:revision/rollback", async (req, res) => {
    try {
      const revision = Number(req.params.revision);
      if (!Number.isInteger(revision) || revision < 1) {
        res.status(400).json({ message: "revision must be a positive integer" });
        return;
      }
      res.json({ item: await rollbackDeployment(req.params.namespace, req.params.name, revision) });
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "rollback failed" });
    }
  });

  app.post("/blueedge/deployments/:namespace/:name/actions/:action", async (req, res) => {
    const action = req.params.action as DeploymentAction;
    if (!actions.has(action)) {
      res.status(400).json({ message: "action must be start, stop or restart" });
      return;
    }
    try {
      res.json({ item: await runDeploymentAction(req.params.namespace, req.params.name, action) });
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "deployment action failed" });
    }
  });

  app.get("/blueedge/deployments/:namespace/:name/audit", async (req, res) => {
    try {
      res.json(await getDeploymentAudit(req.params.namespace, req.params.name));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "failed to read managed fields" });
    }
  });

  app.post("/blueedge/deployments/:namespace/:name/exec", async (req, res) => {
    const pod = typeof req.body?.pod === "string" ? req.body.pod.trim() : "";
    const container = typeof req.body?.container === "string" ? req.body.container.trim() : "";
    const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
    if (!pod || !container || !command) {
      res.status(400).json({ message: "pod, container and command are required" });
      return;
    }
    if (command.length > 4096) {
      res.status(400).json({ message: "command is too long" });
      return;
    }
    try {
      res.json(await executePodCommand(req.params.namespace, req.params.name, { pod, container, command }));
    } catch (error) {
      res.status(errorStatus(error)).json({ message: error instanceof Error ? error.message : "pod exec failed" });
    }
  });
}
