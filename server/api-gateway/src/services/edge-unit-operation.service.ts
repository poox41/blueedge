import { randomUUID } from "node:crypto";
import {
  blueedgeNamespace,
  blueedgeResourceLabel,
  create,
  ensureNamespace,
  getByName,
  listByResourceLabel,
  update,
} from "../repositories/blueedge-configmap.repository.js";
import { createEdgeUnit, deleteEdgeUnit } from "./edge-unit.service.js";
import { dataOf, metadataOf } from "../utils/kubernetes.js";
import { isValidKubernetesName, readStringField } from "../utils/validation.js";

const operationResourceValue = "edge-unit-operation";
type OperationType = "create" | "delete";
type OperationStatus = "pending" | "running" | "succeeded" | "failed";

export interface EdgeUnitOperationView {
  id: string;
  type: OperationType;
  edgeUnitName: string;
  status: OperationStatus;
  stage: string;
  message: string;
  startedAt: string;
  finishedAt?: string;
  result?: any;
}

function resourceName(id: string) {
  return `edgeunit-operation-${id}`;
}

function operationView(configMap: any): EdgeUnitOperationView {
  const data = dataOf(configMap);
  let result: any;
  try { result = data.result ? JSON.parse(data.result) : undefined; } catch { result = undefined; }
  return {
    id: data.id,
    type: data.type as OperationType,
    edgeUnitName: data.edgeUnitName,
    status: data.status as OperationStatus,
    stage: data.stage,
    message: data.message,
    startedAt: data.startedAt,
    ...(data.finishedAt ? { finishedAt: data.finishedAt } : {}),
    ...(result !== undefined ? { result } : {}),
  };
}

async function createOperation(type: OperationType, edgeUnitName: string): Promise<EdgeUnitOperationView> {
  const active = (await listByResourceLabel(operationResourceValue)).map(operationView).find((operation) =>
    operation.edgeUnitName === edgeUnitName && ["pending", "running"].includes(operation.status));
  if (active) throw new Error(`边缘单元 ${edgeUnitName} 已有正在执行的${active.type === "create" ? "创建" : "删除"}任务`);
  const id = randomUUID().replaceAll("-", "");
  const startedAt = new Date().toISOString();
  const data = {
    id,
    type,
    edgeUnitName,
    status: "pending",
    stage: "queued",
    message: type === "create" ? "创建任务已提交，等待安装 CloudCore" : "删除任务已提交，等待卸载 CloudCore",
    startedAt,
    finishedAt: "",
    result: "",
  };
  await ensureNamespace();
  const created = await create({
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: resourceName(id),
      namespace: blueedgeNamespace(),
      labels: { [blueedgeResourceLabel]: operationResourceValue },
    },
    data,
  });
  return operationView(created);
}

async function updateOperation(id: string, fields: Partial<Record<"status" | "stage" | "message" | "finishedAt" | "result", string>>) {
  const existing = await getByName(resourceName(id));
  const resource = {
    ...existing,
    metadata: { ...metadataOf(existing), resourceVersion: metadataOf(existing).resourceVersion },
    data: { ...dataOf(existing), ...fields },
  };
  return operationView(await update(resourceName(id), resource));
}

function runDetached(operation: EdgeUnitOperationView, work: () => Promise<{ status: number; body: any }>) {
  setImmediate(async () => {
    try {
      await updateOperation(operation.id, {
        status: "running",
        stage: operation.type === "create" ? "installing-cloudcore" : "uninstalling-cloudcore",
        message: operation.type === "create" ? "正在安装并等待 CloudCore 就绪" : "正在卸载 CloudCore 并执行命名空间策略",
      });
      const result = await work();
      const succeeded = result.status >= 200 && result.status < 300;
      await updateOperation(operation.id, {
        status: succeeded ? "succeeded" : "failed",
        stage: succeeded ? "completed" : "failed",
        message: succeeded
          ? (operation.type === "create" ? "边缘单元与 CloudCore 创建完成" : "边缘单元与 CloudCore 删除完成")
          : String(result.body?.message || "操作失败"),
        finishedAt: new Date().toISOString(),
        result: JSON.stringify(result.body || {}),
      });
    } catch (error) {
      await updateOperation(operation.id, {
        status: "failed",
        stage: "failed",
        message: error instanceof Error ? error.message : "操作失败",
        finishedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  });
}

export async function startCreateEdgeUnit(body: any) {
  const name = readStringField(body, "name") || "";
  if (!name) return { status: 400, body: { message: "name is required" } };
  if (!isValidKubernetesName(name)) return { status: 400, body: { message: "name must be a valid Kubernetes resource name" } };
  try {
    const operation = await createOperation("create", name);
    runDetached(operation, () => createEdgeUnit(body));
    return { status: 202, body: { operation } };
  } catch (error) {
    return { status: 409, body: { message: error instanceof Error ? error.message : "创建任务提交失败" } };
  }
}

export async function startDeleteEdgeUnit(name: string) {
  try {
    const operation = await createOperation("delete", name);
    runDetached(operation, () => deleteEdgeUnit(name));
    return { status: 202, body: { operation } };
  } catch (error) {
    return { status: 409, body: { message: error instanceof Error ? error.message : "删除任务提交失败" } };
  }
}

export async function getEdgeUnitOperation(id: string) {
  try {
    return { status: 200, body: { operation: operationView(await getByName(resourceName(id))) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务读取失败";
    return { status: /\b404\b|not found/i.test(message) ? 404 : 500, body: { message } };
  }
}
