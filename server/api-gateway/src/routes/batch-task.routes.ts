import type express from "express";
import {
  batchTaskTargetRefs,
  cancelBatchTask,
  createBatchTask,
  deleteBatchTask,
  getBatchTask,
  getBatchTaskAudit,
  getBatchTaskEvents,
  getBatchWorkloadTask,
  listBatchTasks,
  retryBatchTask,
  rollbackBatchTask,
  startBatchTask,
} from "../services/batch-task.service.js";
import {
  addBatchWorkloadDeployments,
  createBatchWorkload,
  deleteBatchWorkload,
  deleteBatchWorkloadDeployment,
  getBatchWorkload,
  getBatchWorkloadAudit,
  getBatchWorkloadEvents,
  listBatchWorkloads,
  updateBatchWorkloadMetadata,
  updateBatchWorkloadYaml,
} from "../services/batch-workload.service.js";

function sendServiceResult(res: express.Response, result: { status: number; body: any }) {
  res.status(result.status).json(result.body);
}

export function registerBatchTaskRoutes(app: express.Express) {
  app.get("/blueedge/batch-tasks", async (_req, res) => {
    try {
      res.json(await listBatchTasks());
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch tasks API is unavailable" });
    }
  });

  app.post("/blueedge/batch-tasks/upgrade", async (req, res) => {
    try {
      sendServiceResult(res, await createBatchTask(req.body, "nodeUpgrade"));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task create API is unavailable" });
    }
  });

  app.post("/blueedge/batch-tasks/image-preheat", async (req, res) => {
    try {
      sendServiceResult(res, await createBatchTask(req.body, "imagePreheat"));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task create API is unavailable" });
    }
  });

  app.get("/blueedge/batch-tasks/:id", async (req, res) => {
    try {
      sendServiceResult(res, await getBatchTask(req.params.id));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task API is unavailable" });
    }
  });

  app.get("/blueedge/batch-tasks/:id/events", async (req, res) => {
    try { sendServiceResult(res, await getBatchTaskEvents(req.params.id)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch task events API is unavailable" }); }
  });

  app.get("/blueedge/batch-tasks/:id/audit", async (req, res) => {
    try { sendServiceResult(res, await getBatchTaskAudit(req.params.id)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch task audit API is unavailable" }); }
  });

  app.post("/blueedge/batch-tasks/:id/start", async (req, res) => {
    try {
      sendServiceResult(res, await startBatchTask(req.params.id));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task start API is unavailable" });
    }
  });

  app.post("/blueedge/batch-tasks/:id/cancel", async (req, res) => {
    try {
      sendServiceResult(res, await cancelBatchTask(req.params.id));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task cancel API is unavailable" });
    }
  });

  app.post("/blueedge/batch-tasks/:id/retry", async (req, res) => {
    try { sendServiceResult(res, await retryBatchTask(req.params.id)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch task retry API is unavailable" }); }
  });

  app.post("/blueedge/batch-tasks/:id/rollback", async (req, res) => {
    try { sendServiceResult(res, await rollbackBatchTask(req.params.id)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch task rollback API is unavailable" }); }
  });

  app.delete("/blueedge/batch-tasks/:id", async (req, res) => {
    try {
      sendServiceResult(res, await deleteBatchTask(req.params.id));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task delete API is unavailable" });
    }
  });

  app.post("/blueedge/workloads/batch", async (req, res) => {
    try {
      sendServiceResult(res, await createBatchWorkload(req.body));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task create API is unavailable" });
    }
  });

  app.get("/blueedge/workloads/batch", async (_req, res) => {
    try { res.json(await listBatchWorkloads()); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload list API is unavailable" }); }
  });

  app.get("/blueedge/workloads/batch/:taskId", async (req, res) => {
    try {
      sendServiceResult(res, await getBatchWorkload(req.params.taskId));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch workload API is unavailable" });
    }
  });

  app.patch("/blueedge/workloads/batch/:taskId", async (req, res) => {
    try { sendServiceResult(res, await updateBatchWorkloadMetadata(req.params.taskId, req.body)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload metadata update API is unavailable" }); }
  });

  app.get("/blueedge/workloads/batch/:taskId/events", async (req, res) => {
    try { sendServiceResult(res, await getBatchWorkloadEvents(req.params.taskId)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload events API is unavailable" }); }
  });

  app.get("/blueedge/workloads/batch/:taskId/audit", async (req, res) => {
    try { sendServiceResult(res, await getBatchWorkloadAudit(req.params.taskId)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload audit API is unavailable" }); }
  });

  app.post("/blueedge/workloads/batch/:taskId/deployments", async (req, res) => {
    try { sendServiceResult(res, await addBatchWorkloadDeployments(req.params.taskId, req.body)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload deployment create API is unavailable" }); }
  });

  app.put("/blueedge/workloads/batch/:taskId/yaml", async (req, res) => {
    try { sendServiceResult(res, await updateBatchWorkloadYaml(req.params.taskId, String(req.body?.yaml || ""))); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload YAML update API is unavailable" }); }
  });

  app.delete("/blueedge/workloads/batch/:taskId/deployments/:deploymentName", async (req, res) => {
    try { sendServiceResult(res, await deleteBatchWorkloadDeployment(req.params.taskId, req.params.deploymentName)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload deployment delete API is unavailable" }); }
  });

  app.delete("/blueedge/workloads/batch/:taskId", async (req, res) => {
    try { sendServiceResult(res, await deleteBatchWorkload(req.params.taskId)); }
    catch (error) { res.status(500).json({ message: error instanceof Error ? error.message : "batch workload delete API is unavailable" }); }
  });
}
