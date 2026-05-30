# BlueEdge Docker Deployment

This directory contains Docker Compose deployment files for BlueEdge:

- `blueedge-frontend`: nginx serving the built React app and proxying `/product-api/*`
- `blueedge-api-gateway`: BlueEdge auth/JWT gateway
- `blueedge-bff`: official KubeEdge Dashboard BFF

## 1. Prepare Server Config

On the server, create `/opt/blueedge/.env`:

```env
BLUEEDGE_IMAGE_TAG=latest
BLUEEDGE_HTTP_PORT=3000

ADMIN_USERNAME=admin
ADMIN_PASSWORD=2026@bluedot
JWT_SECRET=replace-with-openssl-rand-hex-32-output
JWT_EXPIRES_IN=30d

K8S_API_SERVER=https://192.168.16.52:6443
K8S_SKIP_TLS_VERIFY=true
K8S_TOKEN=replace-with-long-lived-kubernetes-token
```

Generate `JWT_SECRET` once and keep it stable:

```bash
openssl rand -hex 32
```

Generate a long-lived Kubernetes token if needed:

```bash
kubectl create token dashboard-user -n kube-system --duration=8760h
```

## 2. Option A: Build On The Server

Copy the repository to the server:

```bash
scp -r . root@14.103.163.121:/opt/blueedge
```

Then on the server:

```bash
cd /opt/blueedge
cp deploy/.env.example .env
# edit .env and fill real secrets
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

Open:

```text
http://14.103.163.121:3000
```

## 3. Option B: Build Locally And Upload Images

Build and export images locally:

```bash
BLUEEDGE_IMAGE_TAG=latest ./scripts/build-docker-images.sh
BLUEEDGE_IMAGE_TAG=latest ./scripts/export-docker-images.sh
```

Upload images and deploy files:

```bash
scp deploy/blueedge-images-latest.tar root@14.103.163.121:/opt/blueedge/
scp deploy/docker-compose.images.yml deploy/.env.example root@14.103.163.121:/opt/blueedge/deploy/
```

Then on the server:

```bash
cd /opt/blueedge
docker load -i blueedge-images-latest.tar
cp deploy/.env.example .env
# edit .env and fill real secrets
docker compose --env-file .env -f deploy/docker-compose.images.yml up -d
```

## 4. Useful Checks

```bash
docker compose --env-file .env -f deploy/docker-compose.yml ps
docker compose --env-file .env -f deploy/docker-compose.yml logs -f blueedge-api-gateway
docker compose --env-file .env -f deploy/docker-compose.yml logs -f blueedge-bff
```

Health check:

```bash
curl -i http://127.0.0.1:3000/product-api/healthz
```

Login check:

```bash
TOKEN="$(curl -s http://127.0.0.1:3000/product-api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"2026@bluedot"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"

curl -i http://127.0.0.1:3000/product-api/bff/node \
  -H "Authorization: Bearer $TOKEN"
```
