import http from "node:http";
import https from "node:https";
import { config } from "../config.js";
import { getK8sJson, requestK8sJson } from "../clients/k8s-client.js";
import type {
  EdgeUnitModelRegistry,
  RegistryCredential,
} from "./edge-unit-model-registry.service.js";

type RegistryCatalog = { repositories?: unknown };
type RegistryTags = { name?: unknown; tags?: unknown };

export type ModelRepository = {
  name: string;
  repository: string;
};

export type ModelImageUpdate = {
  containerName: string;
  model: string;
  tag: string;
  expectedCurrentImage?: string;
};

export type ModelImageUpdateOptions = {
  deploymentAnnotations?: Record<string, string>;
  registry?: ModelRegistryConnection;
};

export type ModelRegistryConnection = {
  url: URL;
  prefix: string;
  skipTlsVerify: boolean;
  credential?: RegistryCredential;
  ca?: string;
};

const modelUpdateAnnotation = "blueedge.io/model-image-updated-at";
const modelContainerAnnotation = "blueedge.io/model-image-container";
const managedByLabel = "blueedge.io/managed-by";
const sourceLabel = "blueedge.io/source";
const modelInitContainerAnnotation = "blueedge.io/model-init-container";

function deploymentPath(namespace: string, name: string) {
  return `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`;
}

function globalRegistryConfiguration(): ModelRegistryConnection {
  if (!config.modelRegistryUrl) throw new Error("模型仓库地址未配置，请配置 MODEL_REGISTRY_URL");
  if (!config.modelRegistryPrefix) throw new Error("模型仓库路径未配置，请配置 MODEL_REGISTRY_PREFIX");
  let url: URL;
  try {
    url = new URL(config.modelRegistryUrl);
  } catch {
    throw new Error("MODEL_REGISTRY_URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MODEL_REGISTRY_URL must use http or https");
  }
  const credential = config.modelRegistryUsername && config.modelRegistryPassword
    ? { type: "basic" as const, username: config.modelRegistryUsername, password: config.modelRegistryPassword }
    : undefined;
  if ((config.modelRegistryUsername || config.modelRegistryPassword) && !credential) {
    throw new Error("模型仓库账号和密码必须同时配置");
  }
  return { url, prefix: config.modelRegistryPrefix, skipTlsVerify: config.modelRegistrySkipTlsVerify, credential };
}

export function edgeUnitRegistryConnection(
  registry: EdgeUnitModelRegistry,
  credential?: RegistryCredential | null,
  ca?: string | null,
): ModelRegistryConnection {
  return {
    url: new URL(`${registry.tls ? "https" : "http"}://${registry.registryHost}`),
    prefix: registry.repositoryPrefix,
    skipTlsVerify: false,
    ...(credential ? { credential } : {}),
    ...(ca ? { ca } : {}),
  };
}

export function registryTlsOptions(registry: ModelRegistryConnection): https.RequestOptions {
  if (registry.url.protocol !== "https:") return {};
  return {
    rejectUnauthorized: !registry.skipTlsVerify,
    ...(registry.ca ? { ca: registry.ca } : {}),
  };
}

function registryAuthorization(credential?: RegistryCredential) {
  if (!credential) return undefined;
  return credential.type === "bearer"
    ? `Bearer ${credential.token}`
    : `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`;
}

async function registryJson<T>(path: string, registry = globalRegistryConfiguration()): Promise<T> {
  const { url: baseUrl } = registry;
  const target = new URL(path, `${baseUrl.toString().replace(/\/+$/, "")}/`);
  const client = target.protocol === "https:" ? https : http;
  const authorization = registryAuthorization(registry.credential);

  return new Promise<T>((resolve, reject) => {
    const request = client.request(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      ...registryTlsOptions(registry),
      timeout: config.requestTimeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const content = Buffer.concat(chunks).toString("utf8");
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`Registry request ${target.pathname} failed: ${status}${content ? ` ${content}` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(content) as T);
        } catch {
          reject(new Error(`Registry request ${target.pathname} returned invalid JSON`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Registry request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function validModelName(value: string) {
  return /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/.test(value) && !value.includes("..");
}

function validTag(value: string) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value);
}

export function modelRepositoriesFromCatalog(repositories: unknown, prefix: string): ModelRepository[] {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  const marker = `${normalizedPrefix}/`;
  if (!Array.isArray(repositories)) return [];
  return repositories
    .filter((repository): repository is string => typeof repository === "string" && repository.startsWith(marker) && repository.length > marker.length)
    .map((repository) => ({ repository, name: repository.slice(marker.length) }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
}

export function modelImageReference(model: string, tag: string, registry = globalRegistryConfiguration()) {
  const { url, prefix } = registry;
  if (!validModelName(model)) throw new Error("model is invalid");
  if (!validTag(tag)) throw new Error("tag is invalid");
  const registryPath = url.pathname.replace(/^\/+|\/+$/g, "");
  const base = [url.host, registryPath, prefix].filter(Boolean).join("/");
  return `${base}/${model}:${tag}`;
}

export function modelImagePrefix(registry = globalRegistryConfiguration()) {
  const { url, prefix } = registry;
  const registryPath = url.pathname.replace(/^\/+|\/+$/g, "");
  return `${[url.host, registryPath, prefix].filter(Boolean).join("/")}/`;
}

export function updateDeploymentModelImage(
  deployment: any,
  payload: ModelImageUpdate,
  nextImage: string,
  expectedImagePrefix = modelImagePrefix(),
  options: ModelImageUpdateOptions = {},
) {
  const copy = structuredClone(deployment);
  const initContainers = copy?.spec?.template?.spec?.initContainers;
  if (!Array.isArray(initContainers)) throw new Error("deployment has no initContainers");
  const target = initContainers.find((container: any) => container?.name === payload.containerName);
  if (!target) throw new Error(`initContainer ${payload.containerName} not found`);
  const currentImage = String(target.image || "");
  const labels = copy?.metadata?.labels || {};
  const annotations = copy?.metadata?.annotations || {};
  const trustedManagedContainer = labels[managedByLabel] === "bams"
    && labels[sourceLabel] === "bams"
    && annotations[modelInitContainerAnnotation] === payload.containerName
    && options.deploymentAnnotations?.[modelInitContainerAnnotation] === payload.containerName;
  if (!currentImage.startsWith(expectedImagePrefix) && !trustedManagedContainer) {
    throw new Error(`initContainer ${payload.containerName} is not a configured model container`);
  }
  if (payload.expectedCurrentImage !== undefined && currentImage !== payload.expectedCurrentImage) {
    throw new Error("model image changed since the page was loaded; refresh and try again");
  }
  if (currentImage === nextImage) throw new Error("selected model image is already in use");

  target.image = nextImage;
  if (options.deploymentAnnotations && Object.keys(options.deploymentAnnotations).length > 0) {
    copy.metadata = copy.metadata || {};
    copy.metadata.annotations = {
      ...(copy.metadata.annotations || {}),
      ...options.deploymentAnnotations,
    };
  }
  copy.spec.template.metadata = copy.spec.template.metadata || {};
  copy.spec.template.metadata.annotations = {
    ...(copy.spec.template.metadata.annotations || {}),
    [modelUpdateAnnotation]: new Date().toISOString(),
    [modelContainerAnnotation]: payload.containerName,
  };
  return { deployment: copy, previousImage: currentImage };
}

export async function listModelRepositories(registry = globalRegistryConfiguration()) {
  const { prefix } = registry;
  const catalog = await registryJson<RegistryCatalog>("v2/_catalog?n=1000", registry);
  return {
    items: modelRepositoriesFromCatalog(catalog.repositories, prefix),
    registry: { prefix, imagePrefix: modelImagePrefix(registry) },
  };
}

export async function listModelTags(model: string, registry = globalRegistryConfiguration()) {
  if (!validModelName(model)) throw new Error("model is invalid");
  const { prefix } = registry;
  const repository = `${prefix}/${model}`;
  const result = await registryJson<RegistryTags>(`v2/${repository.split("/").map(encodeURIComponent).join("/")}/tags/list`, registry);
  const tags = Array.isArray(result.tags)
    ? result.tags.filter((tag): tag is string => typeof tag === "string" && validTag(tag)).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    : [];
  return { model, repository, items: tags };
}

export async function updateModelImage(
  namespace: string,
  name: string,
  payload: ModelImageUpdate,
  options: ModelImageUpdateOptions = {},
) {
  if (!payload.containerName) throw new Error("containerName is required");
  const registry = options.registry || globalRegistryConfiguration();
  const availableTags = await listModelTags(payload.model, registry);
  if (!availableTags.items.includes(payload.tag)) throw new Error(`tag ${payload.tag} was not found for model ${payload.model}`);
  const nextImage = modelImageReference(payload.model, payload.tag, registry);
  const deployment = await getK8sJson(deploymentPath(namespace, name));
  const updated = updateDeploymentModelImage(deployment, payload, nextImage, modelImagePrefix(registry), options);
  const item = await requestK8sJson(deploymentPath(namespace, name), { method: "PUT", body: updated.deployment });
  return {
    item,
    change: {
      containerName: payload.containerName,
      model: payload.model,
      tag: payload.tag,
      previousImage: updated.previousImage,
      image: nextImage,
    },
  };
}
