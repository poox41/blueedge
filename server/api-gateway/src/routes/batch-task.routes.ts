import type express from "express";
import {
  batchTaskTargetRefs,
  cancelBatchTask,
  createBatchTask,
  deleteBatchTask,
  getBatchTask,
  getBatchWorkloadTask,
  listBatchTasks,
  startBatchTask,
} from "../services/batch-task.service.js";

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

  app.delete("/blueedge/batch-tasks/:id", async (req, res) => {
    try {
      sendServiceResult(res, await deleteBatchTask(req.params.id));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task delete API is unavailable" });
    }
  });

  app.post("/blueedge/workloads/batch", async (req, res) => {
    try {
      const body = {
        ...req.body,
        targetType: "deployment",
        targetRefs: batchTaskTargetRefs(req.body),
      };
      sendServiceResult(res, await createBatchTask(body, "batchWorkload"));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch task create API is unavailable" });
    }
  });

  app.get("/blueedge/workloads/batch/:taskId", async (req, res) => {
    try {
      sendServiceResult(res, await getBatchWorkloadTask(req.params.taskId));
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "batch workload API is unavailable" });
    }
  });
}
