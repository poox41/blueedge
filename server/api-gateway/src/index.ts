import { createApp } from "./app.js";
import { config } from "./config.js";
import { hasServerK8sAuthorization } from "./clients/k8s-client.js";
import { startModelSyncController } from "./services/model-sync-controller.service.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`BlueEdge api-gateway listening on http://127.0.0.1:${config.port}`);
  console.log(`BFF base URL: ${config.bffBaseUrl}`);
  if (config.k8sApiServer) console.log(`Kubernetes API server: ${config.k8sApiServer}`);
  if (!hasServerK8sAuthorization()) {
    console.warn("WARNING: no server-side Kubernetes credential found. Set K8S_TOKEN, K8S_AUTH_HEADER, or K8S_TOKEN_FILE.");
  }
  if (config.jwtSecret === "blueedge-dev-secret") console.warn("WARNING: JWT_SECRET is using the development default.");
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    console.warn("WARNING: ADMIN_USERNAME/ADMIN_PASSWORD are using development defaults.");
  }
  startModelSyncController();
});
