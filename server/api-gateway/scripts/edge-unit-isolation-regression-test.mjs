const baseUrl = process.env.BASE_URL || "http://127.0.0.1:7001";
const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD || "";

if (!password) throw new Error("ADMIN_PASSWORD is required");
if (process.env.RUN_WRITE_TESTS !== "true") {
  console.log("SKIP edge-unit isolation regression. Set RUN_WRITE_TESTS=true to execute.");
  process.exit(0);
}

const namespace = process.env.QA_NAMESPACE || "blueedge-e2e";
const resources = {
  nodeGroups: ["qa-nodegroup-a", "qa-nodegroup-b"],
  edgeUnits: ["qa-edge-unit-a", "qa-edge-unit-b", "qa-edge-unit-empty"],
  deployments: ["qa-a-workload", "qa-b-workload-1", "qa-b-workload-2"],
  edgeApplications: ["qa-a-edgeapp", "qa-b-edgeapp-1", "qa-b-edgeapp-2"],
};

let token = "";

async function request(method, path, body, accepted = [200, 201]) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = text;
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!accepted.includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return { status: response.status, payload };
}

async function exists(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await response.text();
  if (response.status === 404) return false;
  if (response.status === 500 && /not found/i.test(text)) return false;
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  return true;
}

async function namespaceExists(name) {
  const result = await request("GET", "/bff/namespace");
  const items = Array.isArray(result.payload?.items) ? result.payload.items : [];
  return items.some((item) => String(item?.metadata?.name || item?.name || "") === name);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT ${message}`);
  pass(message);
}

function deployment(name) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace, labels: { "blueedge.io/test": "edge-unit-isolation" } },
    spec: {
      replicas: 0,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name, "blueedge.io/test": "edge-unit-isolation" } },
        spec: { containers: [{ name: "main", image: "nginx:1.25", imagePullPolicy: "IfNotPresent" }] },
      },
    },
  };
}

function edgeApplication(name, edgeUnitName, nodeGroupName) {
  return {
    apiVersion: "apps.kubeedge.io/v1alpha1",
    kind: "EdgeApplication",
    metadata: {
      name,
      namespace,
      labels: {
        app: name,
        "blueedge.io/test": "edge-unit-isolation",
        "blueedge.io/edge-unit": edgeUnitName,
      },
    },
    spec: {
      workloadScope: { targetNodeGroups: [{ name: nodeGroupName, overrides: {} }] },
      workloadTemplate: {
        manifests: [{
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata: { name, namespace, labels: { app: name, "blueedge.io/edge-unit": edgeUnitName } },
          spec: {
            replicas: 0,
            selector: { matchLabels: { app: name } },
            template: {
              metadata: { labels: { app: name, "blueedge.io/edge-unit": edgeUnitName } },
              spec: { containers: [{ name: "main", image: "nginx:1.25", imagePullPolicy: "IfNotPresent" }] },
            },
          },
        }],
      },
    },
  };
}

async function ignoreDelete(path) {
  try { await request("DELETE", path, undefined, [200, 202, 204, 404]); } catch (error) {
    if (/not found/i.test(error.message)) return;
    console.warn(`WARN cleanup ${path}: ${error.message}`);
  }
}

async function cleanup() {
  for (const name of resources.edgeApplications) {
    await ignoreDelete(`/bff/edgeapplication/${namespace}/${name}`);
  }
  for (const name of resources.deployments) {
    await ignoreDelete(`/bff/deployment/${namespace}/${name}`);
  }
  for (const name of resources.edgeUnits) {
    await ignoreDelete(`/blueedge/edge-units/${name}`);
  }
  for (const name of resources.nodeGroups) {
    await ignoreDelete(`/bff/nodegroup/${name}`);
  }
}

async function main() {
  const login = await request("POST", "/auth/login", { username, password });
  token = login.payload.token || "";
  assert(Boolean(token), "administrator login returns a token");

  for (const name of [...resources.edgeUnits, ...resources.nodeGroups]) {
    const path = resources.edgeUnits.includes(name) ? `/blueedge/edge-units/${name}` : `/bff/nodegroup/${name}`;
    assert(!(await exists(path)), `${name} does not pre-exist`);
  }

  assert(await namespaceExists(namespace), `dedicated test namespace ${namespace} exists`);

  await request("POST", "/bff/nodegroup", {
    apiVersion: "apps.kubeedge.io/v1alpha1",
    kind: "NodeGroup",
    metadata: { name: resources.nodeGroups[0], annotations: { description: "BlueEdge QA isolation group A" } },
    spec: { nodes: ["qa-virtual-edge-a"], matchLabels: {} },
  });
  await request("POST", "/bff/nodegroup", {
    apiVersion: "apps.kubeedge.io/v1alpha1",
    kind: "NodeGroup",
    metadata: { name: resources.nodeGroups[1], annotations: { description: "BlueEdge QA isolation group B" } },
    spec: { nodes: ["qa-virtual-edge-b"], matchLabels: {} },
  });
  pass("created two isolated NodeGroups");

  const edgeUnitBase = {
    clusterName: "kubernetes",
    accessType: "external",
    kubeEdgeVersion: "v1.21.0",
    insightStatus: "unknown",
    monitorStatus: "unknown",
  };
  await request("POST", "/blueedge/edge-units", { ...edgeUnitBase, name: resources.edgeUnits[0], nodeGroupRef: resources.nodeGroups[0], description: "QA isolation A" });
  await request("POST", "/blueedge/edge-units", { ...edgeUnitBase, name: resources.edgeUnits[1], nodeGroupRef: resources.nodeGroups[1], description: "QA isolation B" });
  await request("POST", "/blueedge/edge-units", { ...edgeUnitBase, name: resources.edgeUnits[2], nodeGroupRef: "", description: "QA empty edge unit" });
  pass("created qa-edge-unit-a, qa-edge-unit-b and qa-edge-unit-empty");

  await request("POST", `/blueedge/edge-units/${resources.edgeUnits[0]}/deployments`, deployment(resources.deployments[0]));
  await request("POST", `/blueedge/edge-units/${resources.edgeUnits[1]}/deployments`, deployment(resources.deployments[1]));
  await request("POST", `/blueedge/edge-units/${resources.edgeUnits[1]}/deployments`, deployment(resources.deployments[2]));
  pass("created differentiated 1/2/0 workload data");

  await request("POST", `/bff/edgeapplication/${namespace}`, edgeApplication(resources.edgeApplications[0], resources.edgeUnits[0], resources.nodeGroups[0]));
  await request("POST", `/bff/edgeapplication/${namespace}`, edgeApplication(resources.edgeApplications[1], resources.edgeUnits[1], resources.nodeGroups[1]));
  await request("POST", `/bff/edgeapplication/${namespace}`, edgeApplication(resources.edgeApplications[2], resources.edgeUnits[1], resources.nodeGroups[1]));
  pass("created differentiated 1/2/0 edge application data");

  const a = (await request("GET", `/blueedge/edge-units/${resources.edgeUnits[0]}/resources`)).payload.item;
  const b = (await request("GET", `/blueedge/edge-units/${resources.edgeUnits[1]}/resources`)).payload.item;
  const empty = (await request("GET", `/blueedge/edge-units/${resources.edgeUnits[2]}/resources`)).payload.item;

  assert(a.nodeNames.includes("qa-virtual-edge-a") && !a.nodeNames.includes("qa-virtual-edge-b"), "EdgeUnit A owns only its NodeGroup node");
  assert(b.nodeNames.includes("qa-virtual-edge-b") && !b.nodeNames.includes("qa-virtual-edge-a"), "EdgeUnit B owns only its NodeGroup node");
  const aDeploymentNames = a.deployments.map((item) => item.name).sort();
  const bDeploymentNames = b.deployments.map((item) => item.name).sort();
  console.log(`INFO EdgeUnit A deployments: ${aDeploymentNames.join(",")}`);
  console.log(`INFO EdgeUnit B deployments: ${bDeploymentNames.join(",")}`);
  assert(aDeploymentNames.length === 2 && aDeploymentNames.every((name) => name.startsWith("qa-a-")), "EdgeUnit A owns its direct workload and application Deployment only");
  assert(bDeploymentNames.length === 4 && bDeploymentNames.every((name) => name.startsWith("qa-b-")), "EdgeUnit B owns its direct workloads and application Deployments only");
  assert(a.edgeApplications.length === 1 && a.edgeApplications[0].name === resources.edgeApplications[0], "EdgeUnit A application count is isolated at 1");
  assert(b.edgeApplications.length === 2 && b.edgeApplications.every((item) => item.name.startsWith("qa-b-edgeapp-")), "EdgeUnit B application count is isolated at 2");
  assert(empty.nodeNames.length === 0 && empty.deployments.length === 0 && empty.edgeApplications.length === 0, "EdgeUnit without NodeGroup has 0/0/0 resources");

  const list = (await request("GET", "/blueedge/edge-units")).payload.items;
  const byName = new Map(list.map((item) => [item.name, item]));
  assert(byName.get(resources.edgeUnits[0])?.workloads?.total === 2, "EdgeUnit A overview workload total is 2 including the application Deployment");
  assert(byName.get(resources.edgeUnits[1])?.workloads?.total === 4, "EdgeUnit B overview workload total is 4 including application Deployments");
  assert(byName.get(resources.edgeUnits[2])?.workloads?.total === 0, "empty EdgeUnit overview workload total is 0");
  assert(byName.get(resources.edgeUnits[0])?.applications?.total === 1, "EdgeUnit A overview application total is 1");
  assert(byName.get(resources.edgeUnits[1])?.applications?.total === 2, "EdgeUnit B overview application total is 2");
  assert(byName.get(resources.edgeUnits[2])?.applications?.total === 0, "empty EdgeUnit overview application total is 0");
}

let failed = false;
try {
  await main();
} catch (error) {
  failed = true;
  console.error(`FAIL ${error.message}`);
} finally {
  if (token) await cleanup();
}

if (failed) process.exit(1);
console.log("PASS edge-unit isolation regression completed and cleaned up.");
