import { requestBffJson } from "../clients/bff-client.js";

const defaultEdgeApplicationTargetNodeGroups = [{ name: "edge-group" }];

function withEdgeApplicationWorkloadScope(payload: any) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return {
    ...payload,
    spec: {
      ...(payload.spec || {}),
      workloadScope: {
        ...(payload.spec?.workloadScope || {}),
        targetNodeGroups: Array.isArray(payload.spec?.workloadScope?.targetNodeGroups) &&
          payload.spec.workloadScope.targetNodeGroups.length > 0
          ? payload.spec.workloadScope.targetNodeGroups
          : defaultEdgeApplicationTargetNodeGroups,
      },
    },
  };
}

export function createEdgeApplication(namespace: string, body: any) {
  return requestBffJson(`/edgeapplication/${encodeURIComponent(namespace)}`, {
    method: "POST",
    body: withEdgeApplicationWorkloadScope(body),
  });
}

export function updateEdgeApplication(namespace: string, body: any) {
  return requestBffJson(`/edgeapplication/${encodeURIComponent(namespace)}`, {
    method: "PUT",
    body: withEdgeApplicationWorkloadScope(body),
  });
}
