# OVMS YOLOv8n Manifests Deployment

This guide deploys the three Kubernetes Deployment manifests provided outside the repo:

- `/Users/xiongkai/Downloads/yolov8n-model.yaml`
- `/Users/xiongkai/Downloads/yolov8n-web.yaml`
- `/Users/xiongkai/Downloads/mapper.yaml`

The manifests target the edge node whose label is:

```text
kubernetes.io/hostname=aipc-31
```

They also pull images from the private registry `183.95.195.121:31438` through the image pull secret `my-registry-secret`.

## 1. Prepare Cluster Access

Check that `kubectl` is connected to the target KubeEdge cluster:

```bash
kubectl config current-context
kubectl get nodes -o wide
```

If the current context is empty or points to the wrong cluster, configure kubeconfig first.

## 2. Check The Target Edge Node

The manifests require a node named or labelled as `aipc-31`:

```bash
kubectl get nodes --show-labels | grep aipc-31
kubectl describe node aipc-31
```

If the node does not already have the required hostname label, confirm the actual node name with the team lead before changing it. When approved, label it with:

```bash
kubectl label node <actual-node-name> kubernetes.io/hostname=aipc-31 --overwrite
```

## 3. Prepare The Image Pull Secret

The three manifests reference `my-registry-secret` in the `default` namespace because they do not set `metadata.namespace`.

Create the registry secret if it does not exist:

```bash
kubectl get secret my-registry-secret -n default
kubectl create secret docker-registry my-registry-secret \
  -n default \
  --docker-server=183.95.195.121:31438 \
  --docker-username=<registry-username> \
  --docker-password=<registry-password>
```

If the secret already exists, do not recreate it unless the credentials are wrong.

## 4. Prepare The Host Path

`yolov8n-model.yaml` mounts this host directory on node `aipc-31`:

```text
/mnt/c/models
```

Make sure it exists on the edge node before applying the manifest:

```bash
ssh <edge-node-user>@aipc-31 'mkdir -p /mnt/c/models && ls -ld /mnt/c/models'
```

Use the edge node's reachable SSH address if `aipc-31` is not resolvable from your machine.

## 5. Check Image Architecture

The edge node architecture must match the image architecture. For example, an `arm64` edge node cannot run single-architecture `amd64` images.

Check the edge node architecture:

```bash
kubectl get node aipc-31 -o jsonpath='{.metadata.name}{" "}{.status.nodeInfo.architecture}{"\n"}'
```

If the edge node is `arm64`, ask the image owner to provide `arm64` or multi-architecture images for:

```text
183.95.195.121:31438/model/yolov8n:0.0.1
183.95.195.121:31438/openvino/yolo-web:2026052901
183.95.195.121:31438/openvino/ovms-mapper:2026052903
```

## 6. Apply The Manifests

Deploy the model copier first, then the web service, then the mapper:

```bash
kubectl apply -f /Users/xiongkai/Downloads/yolov8n-model.yaml
kubectl apply -f /Users/xiongkai/Downloads/yolov8n-web.yaml
kubectl apply -f /Users/xiongkai/Downloads/mapper.yaml
```

Check rollout status:

```bash
kubectl rollout status deployment/ov-model -n default --timeout=180s
kubectl rollout status deployment/ov-web -n default --timeout=180s
kubectl rollout status deployment/ovms-mapper -n default --timeout=180s
```

## 7. Verify From Kubernetes

Check Deployment and Pod status:

```bash
kubectl get deploy ov-model ov-web ovms-mapper -n default -o wide
kubectl get pods -n default -o wide | grep -E 'ov-model|ov-web|ovms-mapper'
```

Inspect logs:

```bash
kubectl logs deploy/ov-model -n default
kubectl logs deploy/ov-web -n default
kubectl logs deploy/ovms-mapper -n default
```

Because `ov-web` uses `hostNetwork: true` and exposes container port `8008`, test it from the edge node or any network that can reach the node:

```bash
curl -i http://aipc-31:8008
```

## 8. Verify From BlueEdge

Start or open BlueEdge, then check:

```text
Workloads / Deployments:
- ov-model
- ov-web
- ovms-mapper

Workloads / Pods:
- pods for the three deployments should be Running
```

If using the local development stack:

```bash
./scripts/run-dev-stack.sh start
```

Then open:

```text
http://127.0.0.1:3000
```

## 9. Common Failures

`ImagePullBackOff` or `ErrImagePull` means the node cannot pull from `183.95.195.121:31438`, or `my-registry-secret` is missing or wrong.

If the edge node is `arm64` and the image is single-architecture `amd64`, the pod also fails during image pull. Use an `arm64` or multi-architecture image, or deploy to an `amd64` edge node.

`0/.. nodes are available` usually means the node label `kubernetes.io/hostname=aipc-31` does not match any schedulable node, or the edge node taint/toleration setup is different.

`CreateContainerConfigError` on `ov-model` can happen when `/mnt/c/models` does not exist on the edge node.

`CrashLoopBackOff` requires logs and events:

```bash
kubectl describe pod <pod-name> -n default
kubectl logs <pod-name> -n default --previous
```

## 10. Cleanup

Remove the three deployments:

```bash
kubectl delete -f /Users/xiongkai/Downloads/mapper.yaml
kubectl delete -f /Users/xiongkai/Downloads/yolov8n-web.yaml
kubectl delete -f /Users/xiongkai/Downloads/yolov8n-model.yaml
```
