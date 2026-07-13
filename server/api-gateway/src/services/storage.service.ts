import { getK8sJson } from "../clients/k8s-client.js";
import type { PvcReferenceSources } from "../types/storage.js";
import type { EdgeUnitWarning } from "../types/warnings.js";
import {
  annotationsOf,
  itemsOf,
  labelsOf,
  metadataOf,
  podName,
  podNamespace,
  warning,
} from "../utils/kubernetes.js";

function normalizeStorageStatus(phase: string): string {
  if (phase === "Available") return "available";
  if (phase === "Bound") return "bound";
  if (phase === "Released") return "released";
  if (phase === "Failed") return "failed";
  if (phase === "Pending") return "pending";
  return "unknown";
}

function storageClassView(item: any) {
  const annotations = annotationsOf(item);
  return {
    name: metadataOf(item).name || "",
    provisioner: item?.provisioner || "",
    reclaimPolicy: item?.reclaimPolicy || "",
    volumeBindingMode: item?.volumeBindingMode || "",
    allowVolumeExpansion: Boolean(item?.allowVolumeExpansion),
    isDefault: annotations["storageclass.kubernetes.io/is-default-class"] === "true" ||
      annotations["storageclass.beta.kubernetes.io/is-default-class"] === "true",
    parameters: item?.parameters && typeof item.parameters === "object" ? item.parameters : {},
  };
}

async function getStorageClassItems(warnings: EdgeUnitWarning[]) {
  const data = await getK8sJson("/apis/storage.k8s.io/v1/storageclasses").catch((error) => {
    warnings.push(warning("storageclass", error, "StorageClass list unavailable"));
    return null;
  });
  return itemsOf(data);
}

function persistentVolumeSource(pv: any) {
  const spec = pv?.spec || {};
  if (spec.csi) return { type: "csi", driver: spec.csi.driver || "", path: spec.csi.volumeHandle || "", fsType: spec.csi.fsType || "" };
  if (spec.hostPath) return { type: "hostPath", driver: "", path: spec.hostPath.path || "", fsType: "" };
  if (spec.nfs) return { type: "nfs", driver: spec.nfs.server || "", path: spec.nfs.path || "", fsType: "" };
  if (spec.local) return { type: "local", driver: "", path: spec.local.path || "", fsType: "" };
  if (spec.awsElasticBlockStore) return { type: "awsElasticBlockStore", driver: "", path: spec.awsElasticBlockStore.volumeID || "", fsType: spec.awsElasticBlockStore.fsType || "" };
  if (spec.gcePersistentDisk) return { type: "gcePersistentDisk", driver: "", path: spec.gcePersistentDisk.pdName || "", fsType: spec.gcePersistentDisk.fsType || "" };
  return { type: "unknown", driver: "", path: "", fsType: "" };
}

function persistentVolumeView(pv: any, pvcByRef: Map<string, any>, storageClasses: any[], usedBy: any[] = []) {
  const spec = pv?.spec || {};
  const claimRef = spec.claimRef;
  const claimKey = claimRef?.namespace && claimRef?.name ? `${claimRef.namespace}/${claimRef.name}` : "";
  const claim = claimKey ? pvcByRef.get(claimKey) : null;
  const phase = pv?.status?.phase || "Unknown";
  const storageClass = storageClasses.find((item) => metadataOf(item).name === spec.storageClassName);
  return {
    name: metadataOf(pv).name || "",
    status: normalizeStorageStatus(phase),
    phase,
    capacity: spec.capacity?.storage || "",
    accessModes: Array.isArray(spec.accessModes) ? spec.accessModes : [],
    reclaimPolicy: spec.persistentVolumeReclaimPolicy || "",
    storageClass: spec.storageClassName || "",
    storageClassInfo: storageClass ? storageClassView(storageClass) : null,
    volumeMode: spec.volumeMode || "Filesystem",
    claim: claimRef ? { namespace: claimRef.namespace || "", name: claimRef.name || "" } : null,
    claimInfo: claim ? { namespace: metadataOf(claim).namespace || "", name: metadataOf(claim).name || "", phase: claim?.status?.phase || "" } : null,
    source: persistentVolumeSource(pv),
    nodeAffinity: spec.nodeAffinity || {},
    usedBy,
    usedByCount: usedBy.length,
    createdAt: metadataOf(pv).creationTimestamp || "",
    labels: labelsOf(pv),
    annotations: annotationsOf(pv),
    raw: pv,
  };
}

function pvcKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

function pvcClaimNameInVolume(volume: any): string {
  return String(volume?.persistentVolumeClaim?.claimName || "");
}

function workloadVolumes(workload: any): any[] {
  const volumes = workload?.spec?.template?.spec?.volumes;
  return Array.isArray(volumes) ? volumes : [];
}

function scanPvcUsedBy(namespace: string, pvcName: string, sources: PvcReferenceSources) {
  const refs: Array<{ kind: string; namespace: string; name: string; path: string }> = [];
  sources.pods
    .filter((pod) => podNamespace(pod) === namespace)
    .forEach((pod) => {
      const volumes = Array.isArray(pod?.spec?.volumes) ? pod.spec.volumes : [];
      volumes.forEach((volume: any, index: number) => {
        if (pvcClaimNameInVolume(volume) === pvcName) refs.push({ kind: "Pod", namespace, name: podName(pod), path: `spec.volumes[${index}]` });
      });
    });

  ([
    ["Deployment", sources.deployments],
    ["StatefulSet", sources.statefulSets],
    ["DaemonSet", sources.daemonSets],
  ] as const).forEach(([kind, items]) => {
    items
      .filter((item) => String(metadataOf(item).namespace || "default") === namespace)
      .forEach((item) => {
        workloadVolumes(item).forEach((volume: any, index: number) => {
          if (pvcClaimNameInVolume(volume) === pvcName) refs.push({ kind, namespace, name: String(metadataOf(item).name || ""), path: `spec.template.spec.volumes[${index}]` });
        });
      });
  });
  return refs;
}

async function collectPvcReferenceSources(warnings: EdgeUnitWarning[], namespace?: string): Promise<PvcReferenceSources> {
  const nsPath = namespace ? `/namespaces/${encodeURIComponent(namespace)}` : "";
  const [pods, deployments, statefulSets, daemonSets] = await Promise.all([
    getK8sJson(namespace ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods` : "/api/v1/pods").then(itemsOf).catch((error) => {
      warnings.push(warning("pods", error, "Pod list unavailable"));
      return [];
    }),
    getK8sJson(`/apis/apps/v1${nsPath}/deployments`).then(itemsOf).catch((error) => {
      warnings.push(warning("deployments", error, "Deployment list unavailable"));
      return [];
    }),
    getK8sJson(`/apis/apps/v1${nsPath}/statefulsets`).then(itemsOf).catch((error) => {
      warnings.push(warning("statefulsets", error, "StatefulSet list unavailable"));
      return [];
    }),
    getK8sJson(`/apis/apps/v1${nsPath}/daemonsets`).then(itemsOf).catch((error) => {
      warnings.push(warning("daemonsets", error, "DaemonSet list unavailable"));
      return [];
    }),
  ]);
  return { pods, deployments, statefulSets, daemonSets };
}

function persistentVolumeClaimView(pvc: any, pvByName: Map<string, any>, storageClasses: any[], usedBy: any[] = []) {
  const spec = pvc?.spec || {};
  const status = pvc?.status || {};
  const phase = status.phase || "Unknown";
  const volume = spec.volumeName || "";
  const pv = volume ? pvByName.get(volume) : null;
  const storageClass = storageClasses.find((item) => metadataOf(item).name === spec.storageClassName);
  return {
    namespace: metadataOf(pvc).namespace || "default",
    name: metadataOf(pvc).name || "",
    status: normalizeStorageStatus(phase),
    phase,
    requestedCapacity: spec.resources?.requests?.storage || "",
    actualCapacity: status.capacity?.storage || pv?.spec?.capacity?.storage || "",
    accessModes: Array.isArray(spec.accessModes) ? spec.accessModes : [],
    storageClass: spec.storageClassName || "",
    storageClassInfo: storageClass ? storageClassView(storageClass) : null,
    volume,
    volumeInfo: pv ? { name: metadataOf(pv).name || "", phase: pv?.status?.phase || "", reclaimPolicy: pv?.spec?.persistentVolumeReclaimPolicy || "" } : null,
    volumeMode: spec.volumeMode || "Filesystem",
    selector: spec.selector || null,
    conditions: Array.isArray(status.conditions) ? status.conditions : [],
    usedBy,
    usedByCount: usedBy.length,
    createdAt: metadataOf(pvc).creationTimestamp || "",
    labels: labelsOf(pvc),
    annotations: annotationsOf(pvc),
    raw: pvc,
  };
}

export async function listStorageClasses() {
  const warnings: EdgeUnitWarning[] = [];
  const storageClasses = await getStorageClassItems(warnings);
  return { items: storageClasses.map(storageClassView), ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function listPersistentVolumeSummaries() {
  const warnings: EdgeUnitWarning[] = [];
  const pvData = await getK8sJson("/api/v1/persistentvolumes");
  const [pvcData, storageClasses] = await Promise.all([
    getK8sJson("/api/v1/persistentvolumeclaims").catch((error) => {
      warnings.push(warning("persistentvolumeclaims", error, "PVC list unavailable"));
      return null;
    }),
    getStorageClassItems(warnings),
  ]);
  const pvcByRef = new Map(itemsOf(pvcData).map((pvc) => [pvcKey(metadataOf(pvc).namespace || "default", metadataOf(pvc).name || ""), pvc]));
  return {
    items: itemsOf(pvData).map((pv) => persistentVolumeView(pv, pvcByRef, storageClasses)),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function getPersistentVolumeSummary(name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const pv = await getK8sJson(`/api/v1/persistentvolumes/${encodeURIComponent(name)}`);
  const claimRef = pv?.spec?.claimRef;
  const namespace = claimRef?.namespace || "";
  const claimName = claimRef?.name || "";
  const [pvc, storageClasses, refs] = await Promise.all([
    namespace && claimName
      ? getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(claimName)}`).catch((error) => {
        warnings.push(warning("persistentvolumeclaim", error, "bound PVC unavailable"));
        return null;
      })
      : Promise.resolve(null),
    getStorageClassItems(warnings),
    namespace && claimName
      ? collectPvcReferenceSources(warnings, namespace).then((sources) => scanPvcUsedBy(namespace, claimName, sources))
      : Promise.resolve([]),
  ]);
  const pvcByRef = new Map(pvc ? [[pvcKey(namespace, claimName), pvc]] : []);
  return { item: persistentVolumeView(pv, pvcByRef, storageClasses, refs), ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function listPersistentVolumeClaimSummaries(namespace: string) {
  const warnings: EdgeUnitWarning[] = [];
  const path = namespace
    ? `/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`
    : "/api/v1/persistentvolumeclaims";
  const pvcData = await getK8sJson(path);
  const [pvData, storageClasses, sources] = await Promise.all([
    getK8sJson("/api/v1/persistentvolumes").catch((error) => {
      warnings.push(warning("persistentvolumes", error, "PV list unavailable"));
      return null;
    }),
    getStorageClassItems(warnings),
    collectPvcReferenceSources(warnings, namespace || undefined),
  ]);
  const pvByName = new Map(itemsOf(pvData).map((pv) => [metadataOf(pv).name || "", pv]));
  return {
    items: itemsOf(pvcData).map((pvc) => {
      const ns = metadataOf(pvc).namespace || "default";
      const name = metadataOf(pvc).name || "";
      const usedBy = scanPvcUsedBy(ns, name, sources);
      return persistentVolumeClaimView(pvc, pvByName, storageClasses, usedBy);
    }),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function getPersistentVolumeClaimSummary(namespace: string, name: string) {
  const warnings: EdgeUnitWarning[] = [];
  const pvc = await getK8sJson(`/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(name)}`);
  const [pvData, storageClasses, sources] = await Promise.all([
    getK8sJson("/api/v1/persistentvolumes").catch((error) => {
      warnings.push(warning("persistentvolumes", error, "PV list unavailable"));
      return null;
    }),
    getStorageClassItems(warnings),
    collectPvcReferenceSources(warnings, namespace),
  ]);
  const pvByName = new Map(itemsOf(pvData).map((pv) => [metadataOf(pv).name || "", pv]));
  const usedBy = scanPvcUsedBy(namespace, name, sources);
  return { item: persistentVolumeClaimView(pvc, pvByName, storageClasses, usedBy), ...(warnings.length > 0 ? { warnings } : {}) };
}
