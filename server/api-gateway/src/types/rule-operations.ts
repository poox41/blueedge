import type { LegacyEventItem } from "./events.js";

export interface RuleDeliverySummary {
  successMessages: number;
  failMessages: number;
  totalMessages: number;
  errors: string[];
  source: "Rule.status";
  completeHistory: false;
  warning: string;
}

export interface RuleAuditItem {
  manager: string;
  operation: string;
  apiVersion: string;
  subresource: string;
  time: string;
}

export interface RuleAuditResponse {
  items: RuleAuditItem[];
  source: "metadata.managedFields";
  completeAuditLog: false;
  warning: string;
}

export interface RuleEventsResponse {
  items: LegacyEventItem[];
  source: "core/v1 Event";
}
