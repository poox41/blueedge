import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { MainLayout } from "@/components/layout/MainLayout";
import { LoginPage } from "@/pages/LoginPage";
import Home from "@/pages/Home";
import { Dashboard } from "@/pages/Dashboard";
import { Nodes } from "@/pages/Nodes";
import { AccessNodePage } from "@/pages/AccessNodePage";
import { NodeGroups } from "@/pages/NodeGroups";
import { BatchTasks } from "@/pages/BatchTasks";
import { Deployments } from "@/pages/Deployments";
import { BatchWorkloads } from "@/pages/BatchWorkloads";
import { Pods } from "@/pages/Pods";
import { EdgeApps } from "@/pages/EdgeApps";
import { PersistentVolumes } from "@/pages/PersistentVolumes";
import { PersistentVolumeClaims } from "@/pages/PersistentVolumeClaims";
import { DeviceModels } from "@/pages/DeviceModels";
import { DeviceInstances } from "@/pages/DeviceInstances";
import { RuleEndpoints } from "@/pages/RuleEndpoints";
import { Rules } from "@/pages/Rules";
import { Services } from "@/pages/Services";
import { ConfigMaps } from "@/pages/ConfigMaps";
import { Secrets } from "@/pages/Secrets";
import { ServiceAccounts } from "@/pages/ServiceAccounts";
import { Roles } from "@/pages/Roles";
import { RoleBindings } from "@/pages/RoleBindings";
import { ClusterRoles } from "@/pages/ClusterRoles";
import { ClusterRoleBindings } from "@/pages/ClusterRoleBindings";
import { CustomResourceDefinitions } from "@/pages/CustomResourceDefinitions";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Home />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/nodes" element={<Nodes />} />
        <Route path="/nodes/access" element={<AccessNodePage />} />
        <Route path="/nodegroups" element={<NodeGroups />} />
        <Route path="/batchtasks" element={<BatchTasks />} />
        <Route path="/deployments" element={<Deployments />} />
        <Route path="/batchworkloads" element={<BatchWorkloads />} />
        <Route path="/pods" element={<Pods />} />
        <Route path="/edgeapps" element={<EdgeApps />} />
        <Route path="/persistentvolumes" element={<PersistentVolumes />} />
        <Route path="/persistentvolumeclaims" element={<PersistentVolumeClaims />} />
        <Route path="/devicemodels" element={<DeviceModels />} />
        <Route path="/deviceinstances" element={<DeviceInstances />} />
        <Route path="/ruleendpoints" element={<RuleEndpoints />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/services" element={<Services />} />
        <Route path="/configmaps" element={<ConfigMaps />} />
        <Route path="/secrets" element={<Secrets />} />
        <Route path="/serviceaccounts" element={<ServiceAccounts />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/rolebindings" element={<RoleBindings />} />
        <Route path="/clusterroles" element={<ClusterRoles />} />
        <Route path="/clusterrolebindings" element={<ClusterRoleBindings />} />
        <Route path="/crds" element={<CustomResourceDefinitions />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </HashRouter>
  );
}

export default App;
