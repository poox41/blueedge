import { getJson } from "../clients/bff-client.js";
import { getLegacyEvents } from "./events.service.js";
import type { RuleAuditItem, RuleAuditResponse, RuleDeliverySummary, RuleEventsResponse } from "../types/rule-operations.js";

function rulePath(namespace: string, name: string) {
  return `/rule/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}

function unwrapResource(value: any): any {
  return value?.data && typeof value.data === "object" ? value.data : value;
}

function count(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function errorMessages(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : JSON.stringify(item));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (value && typeof value === "object") return [JSON.stringify(value)];
  return [];
}

export function ruleDeliverySummary(resourceValue: unknown): RuleDeliverySummary {
  const resource = unwrapResource(resourceValue);
  const status = resource?.status && typeof resource.status === "object" ? resource.status : {};
  const successMessages = count(status.successMessages);
  const failMessages = count(status.failMessages);
  return {
    successMessages,
    failMessages,
    totalMessages: successMessages + failMessages,
    errors: errorMessages(status.errors),
    source: "Rule.status",
    completeHistory: false,
    warning: "当前 KubeEdge Rule 只提供成功/失败累计数，不提供逐条消息投递历史。",
  };
}

export function ruleAuditView(resourceValue: unknown): RuleAuditResponse {
  const resource = unwrapResource(resourceValue);
  const fields = Array.isArray(resource?.metadata?.managedFields) ? resource.metadata.managedFields : [];
  const items: RuleAuditItem[] = fields
    .map((field: any): RuleAuditItem => ({
      manager: String(field?.manager || "unknown"),
      operation: String(field?.operation || "unknown"),
      apiVersion: String(field?.apiVersion || ""),
      subresource: String(field?.subresource || ""),
      time: String(field?.time || ""),
    }))
    .sort((left: RuleAuditItem, right: RuleAuditItem) => right.time.localeCompare(left.time));
  return {
    items,
    source: "metadata.managedFields",
    completeAuditLog: false,
    warning: "当前集群未向 BlueEdge 暴露 Kubernetes Audit 日志；这里展示资源 managedFields，不包含操作者 IP。",
  };
}

export async function getRuleDelivery(namespace: string, name: string): Promise<RuleDeliverySummary> {
  return ruleDeliverySummary(await getJson(rulePath(namespace, name)));
}

export async function getRuleAudit(namespace: string, name: string): Promise<RuleAuditResponse> {
  return ruleAuditView(await getJson(rulePath(namespace, name)));
}

export async function getRuleEvents(namespace: string, name: string): Promise<RuleEventsResponse> {
  const result = await getLegacyEvents(namespace, { kind: "Rule", name });
  return { items: result.items, source: "core/v1 Event" };
}
