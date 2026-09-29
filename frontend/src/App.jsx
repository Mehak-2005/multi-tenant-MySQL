import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/Dashboard";
import Tenants from "./pages/Tenants";
import TenantDetails from "./pages/TenantDetails";
import ProvisionTenant from "./pages/ProvisionTenant";
import QueryDatabase from "./pages/QueryDatabase";
import Jobs from "./pages/Jobs";
import JobDetails from "./pages/JobDetails";
import Hosts from "./pages/Hosts";
import Backups from "./pages/Backups";
import Restore from "./pages/Restore";
import SystemHealth from "./pages/SystemHealth";
import Settings from "./pages/Settings";
import { ToastProvider } from "./hooks/useToast";
import "./App.css";

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="tenants/:tenantId" element={<TenantDetails />} />
            <Route path="tenants/:tenantId/query" element={<QueryDatabase />} />
            <Route path="provision" element={<ProvisionTenant />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:jobId" element={<JobDetails />} />
            <Route path="hosts" element={<Hosts />} />
            <Route path="backups" element={<Backups />} />
            <Route path="restore" element={<Restore />} />
            <Route path="health" element={<SystemHealth />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}