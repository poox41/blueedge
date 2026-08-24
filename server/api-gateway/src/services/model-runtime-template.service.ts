import { config, isPinnedContainerImage } from "../config.js";

export type ModelRuntimeTemplateId = "triton-work-amd64" | "triton-work-arm64";

export type ModelRuntimeTemplate = {
  id: ModelRuntimeTemplateId;
  version: "2";
  architecture: "amd64" | "arm64";
  artifactSourcePath: "/work";
  runtimeContainerName: "triton";
};

const templates: Record<string, ModelRuntimeTemplate> = {
  "triton-work-amd64": {
    id: "triton-work-amd64",
    version: "2",
    architecture: "amd64",
    artifactSourcePath: "/work",
    runtimeContainerName: "triton",
  },
  "triton-work-arm64": {
    id: "triton-work-arm64",
    version: "2",
    architecture: "arm64",
    artifactSourcePath: "/work",
    runtimeContainerName: "triton",
  },
};

export function resolveModelRuntimeTemplate(templateId = "triton-work-amd64"): ModelRuntimeTemplate {
  const template = templates[templateId];
  if (!template) throw new Error("unsupported runtime template or model artifact layout");
  return template;
}

export function runtimeTemplateIdForPredictFramework(predictFramework?: string): ModelRuntimeTemplateId {
  const framework = String(predictFramework || "").trim().toLowerCase();
  if (["triton-arm64", "triton-bams-arm64", "triton-dce-arm64"].includes(framework)) {
    return "triton-work-arm64";
  }
  return "triton-work-amd64";
}

export function buildTritonDeployment(input: {
  name: string;
  namespace: string;
  image: string;
  modelName: string;
  initContainerName: string;
  targetNode: string;
  edgeUnit: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  pullSecret: string;
  template: ModelRuntimeTemplate;
}) {
  const isArm64 = input.template.architecture === "arm64";
  const runtimeImage = isArm64 ? config.tritonArm64RuntimeImage : config.tritonAmd64RuntimeImage;
  const runtimeImageVariable = isArm64 ? "TRITON_ARM64_RUNTIME_IMAGE" : "TRITON_AMD64_RUNTIME_IMAGE";
  if (!isPinnedContainerImage(runtimeImage)) {
    throw new Error(`${runtimeImageVariable} must use an explicit non-latest tag or sha256 digest`);
  }
  const cpuRequest = isArm64 ? config.tritonArm64CpuRequest : config.tritonAmd64CpuRequest;
  const cpuLimit = isArm64 ? config.tritonArm64CpuLimit : config.tritonAmd64CpuLimit;
  const memoryRequest = isArm64 ? config.tritonArm64MemoryRequest : config.tritonAmd64MemoryRequest;
  const memoryLimit = isArm64 ? config.tritonArm64MemoryLimit : config.tritonAmd64MemoryLimit;
  const podLabels = { ...input.labels, app: input.name };
  const modelDirectory = `/model-repo/${input.modelName}`;
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: input.name,
      namespace: input.namespace,
      labels: { ...input.labels, app: input.name },
      annotations: input.annotations,
    },
    spec: {
      replicas: 1,
      revisionHistoryLimit: 10,
      progressDeadlineSeconds: 600,
      strategy: { type: "Recreate" },
      selector: { matchLabels: podLabels },
      template: {
        metadata: { labels: podLabels },
        spec: {
          nodeName: input.targetNode,
          tolerations: [{ key: "node-role.kubernetes.io/edge", operator: "Exists", effect: "NoSchedule" }],
          imagePullSecrets: [{ name: input.pullSecret }],
          volumes: [{ name: "model-repo", emptyDir: {} }],
          initContainers: [{
            name: input.initContainerName,
            image: input.image,
            imagePullPolicy: "IfNotPresent",
            command: ["/bin/sh", "-c"],
            args: [
              `rm -rf ${modelDirectory} && mkdir -p ${modelDirectory} && cp -a ${input.template.artifactSourcePath}/. ${modelDirectory}/`,
            ],
            volumeMounts: [{ name: "model-repo", mountPath: "/model-repo" }],
          }],
          containers: [{
            name: input.template.runtimeContainerName,
            image: runtimeImage,
            imagePullPolicy: "IfNotPresent",
            command: ["tritonserver"],
            args: [
              "--model-repository=/model-repo",
              "--strict-model-config=false",
              "--exit-on-error=true",
              "--log-info=true",
            ],
            ports: [
              { name: "http", containerPort: 8000 },
              { name: "grpc", containerPort: 8001 },
              { name: "metrics", containerPort: 8002 },
            ],
            startupProbe: {
              httpGet: { path: "/v2/health/ready", port: 8000 },
              periodSeconds: 5,
              failureThreshold: 60,
            },
            readinessProbe: {
              httpGet: { path: "/v2/health/ready", port: 8000 },
              periodSeconds: 5,
              failureThreshold: 3,
            },
            livenessProbe: {
              httpGet: { path: "/v2/health/live", port: 8000 },
              periodSeconds: 10,
              failureThreshold: 3,
            },
            resources: {
              requests: { cpu: cpuRequest, memory: memoryRequest },
              limits: { cpu: cpuLimit, memory: memoryLimit },
            },
            volumeMounts: [{ name: "model-repo", mountPath: "/model-repo" }],
          }],
        },
      },
    },
  };
}
