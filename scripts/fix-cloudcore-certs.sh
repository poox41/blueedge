#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-kubeedge}"
DEPLOYMENT="${DEPLOYMENT:-cloudcore}"
SECRET="${SECRET:-cloudcore}"
CLOUDCORE_IP="${CLOUDCORE_IP:-192.168.16.52}"
WORKDIR="${WORKDIR:-/tmp/cloudcore-cert-fix}"

command -v kubectl >/dev/null
command -v openssl >/dev/null

rm -rf "$WORKDIR/existing" "$WORKDIR/generated"
mkdir -p "$WORKDIR/existing" "$WORKDIR/generated"

echo "Using namespace:   $NAMESPACE"
echo "Using deployment:  $DEPLOYMENT"
echo "Using secret:      $SECRET"
echo "Using cloudcore IP:$CLOUDCORE_IP"
echo

echo "Backing up current deployment and secret..."
kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" -o yaml > "$WORKDIR/${DEPLOYMENT}.deployment.backup.yaml"
kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" -o json > "$WORKDIR/${DEPLOYMENT}.deployment.json"
kubectl -n "$NAMESPACE" get secret "$SECRET" -o yaml > "$WORKDIR/${SECRET}.secret.backup.yaml"

echo "Extracting existing secret data..."
kubectl -n "$NAMESPACE" get secret "$SECRET" -o jsonpath='{range $k,$v := .data}{printf "%s\n" $k}{end}' \
  | while IFS= read -r key; do
      [ -n "$key" ] || continue
      kubectl -n "$NAMESPACE" get secret "$SECRET" -o "jsonpath={.data.${key}}" \
        | base64 -d > "$WORKDIR/existing/$key"
    done

echo "Preparing secret data..."
cp -a "$WORKDIR/existing/." "$WORKDIR/generated/" 2>/dev/null || true

echo "Generating missing CloudCore 10002 HTTPS certificates..."
if [ -f "$WORKDIR/existing/rootCA.key" ] && [ -f "$WORKDIR/existing/rootCA.crt" ]; then
  cp "$WORKDIR/existing/rootCA.key" "$WORKDIR/generated/rootCA.key"
  cp "$WORKDIR/existing/rootCA.crt" "$WORKDIR/generated/rootCA.crt"
elif [ -f "$WORKDIR/existing/rootCA.key" ] || [ -f "$WORKDIR/existing/rootCA.crt" ]; then
  echo "ERROR: existing secret has only one of rootCA.key/rootCA.crt. Back up and fix the secret manually first."
  exit 1
else
  openssl genrsa -out "$WORKDIR/generated/rootCA.key" 2048
  openssl req -x509 -new -nodes \
    -key "$WORKDIR/generated/rootCA.key" \
    -subj "/CN=kubeedge-root-ca" \
    -days 3650 \
    -out "$WORKDIR/generated/rootCA.crt"
fi

cat > "$WORKDIR/generated/edge-openssl.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = cloudcore

[v3_req]
keyUsage = keyEncipherment, dataEncipherment, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = cloudcore
DNS.2 = cloudcore.${NAMESPACE}
DNS.3 = cloudcore.${NAMESPACE}.svc
DNS.4 = cloudcore.${NAMESPACE}.svc.cluster.local
IP.1 = ${CLOUDCORE_IP}
IP.2 = 127.0.0.1
EOF

openssl genrsa -out "$WORKDIR/generated/edge.key" 2048
openssl req -new \
  -key "$WORKDIR/generated/edge.key" \
  -out "$WORKDIR/generated/edge.csr" \
  -config "$WORKDIR/generated/edge-openssl.cnf"
openssl x509 -req \
  -in "$WORKDIR/generated/edge.csr" \
  -CA "$WORKDIR/generated/rootCA.crt" \
  -CAkey "$WORKDIR/generated/rootCA.key" \
  -CAcreateserial \
  -out "$WORKDIR/generated/edge.crt" \
  -days 3650 \
  -extensions v3_req \
  -extfile "$WORKDIR/generated/edge-openssl.cnf"

rm -f "$WORKDIR/generated/edge.csr" "$WORKDIR/generated/edge-openssl.cnf" "$WORKDIR/generated/rootCA.srl"

echo "Updating secret $SECRET..."
kubectl -n "$NAMESPACE" create secret generic "$SECRET" \
  --from-file="$WORKDIR/generated" \
  --dry-run=client \
  -o yaml \
  | kubectl apply -f -

echo "Patching deployment secret volume items..."
python3 - "$WORKDIR/${DEPLOYMENT}.deployment.json" "$WORKDIR/${DEPLOYMENT}.patch.json" "$SECRET" <<'PY'
import json
import sys

deployment_path, patch_path, secret_name = sys.argv[1], sys.argv[2], sys.argv[3]
with open(deployment_path, "r", encoding="utf-8") as f:
    deployment = json.load(f)

volumes = deployment["spec"]["template"]["spec"].get("volumes", [])
secret_volume_index = None
for index, volume in enumerate(volumes):
    secret = volume.get("secret")
    if secret and secret.get("secretName") == secret_name:
        secret_volume_index = index
        break

if secret_volume_index is None:
    raise SystemExit(f"Could not find a volume using secretName={secret_name}")

items = [
    {"key": "rootCA.crt", "path": "ca/rootCA.crt"},
    {"key": "rootCA.key", "path": "ca/rootCA.key"},
    {"key": "edge.crt", "path": "certs/edge.crt"},
    {"key": "edge.key", "path": "certs/edge.key"},
    {"key": "stream.crt", "path": "certs/stream.crt"},
    {"key": "stream.key", "path": "certs/stream.key"},
    {"key": "streamCA.crt", "path": "ca/streamCA.crt"},
]

patch = [
    {
        "op": "replace",
        "path": f"/spec/template/spec/volumes/{secret_volume_index}/secret/items",
        "value": items,
    }
]

with open(patch_path, "w", encoding="utf-8") as f:
    json.dump(patch, f)
PY

kubectl -n "$NAMESPACE" patch deployment "$DEPLOYMENT" --type=json --patch-file "$WORKDIR/${DEPLOYMENT}.patch.json"

echo "Restarting cloudcore deployment..."
kubectl -n "$NAMESPACE" rollout restart deployment "$DEPLOYMENT"
kubectl -n "$NAMESPACE" rollout status deployment "$DEPLOYMENT" --timeout=120s

echo
echo "Done. Verify from the edge node with:"
echo "  openssl s_client -connect ${CLOUDCORE_IP}:10002 -servername ${CLOUDCORE_IP} </dev/null"
echo
echo "Then retry:"
echo "  sudo keadm join --cloudcore-ipport=${CLOUDCORE_IP}:10000 --token=<token> --edgenode-name=k8s-laptop-edge"
