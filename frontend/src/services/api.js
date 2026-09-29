import axios from "axios";
import {
  mockTenants,
  mockJobs,
  mockHosts,
  mockBackups,
  mockHealth,
} from "./mockData";

// Resolve base URL from environment variable or user runtime override in localStorage
const getBaseUrl = () => {
  const customUrl = localStorage.getItem("custom_api_base_url");
  if (customUrl && customUrl.trim()) {
    return customUrl.trim().replace(/\/$/, "");
  }
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, "");
  }
  return "https://d4y21daiz5.execute-api.ap-south-1.amazonaws.com/Prod";
};

export const getApiBaseUrl = getBaseUrl;

export const isMockDataEnabled = () => {
  const localOverride = localStorage.getItem("use_mock_data");
  if (localOverride !== null) {
    return localOverride === "true";
  }
  return import.meta.env.VITE_USE_MOCK_DATA === "true";
};

export const setMockDataEnabled = (enabled) => {
  localStorage.setItem("use_mock_data", enabled ? "true" : "false");
};

export const setCustomApiBaseUrl = (url) => {
  if (url && url.trim()) {
    localStorage.setItem("custom_api_base_url", url.trim().replace(/\/$/, ""));
  } else {
    localStorage.removeItem("custom_api_base_url");
  }
};

// Create Centralized Axios Client
const apiClient = axios.create({
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Dynamic baseURL interceptor
apiClient.interceptors.request.use(
  (config) => {
    config.baseURL = getBaseUrl();
    return config;
  },
  (error) => Promise.reject(error)
);

// Response error normalization
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    let normalizedError = {
      status: error.response?.status || 500,
      message: "An unexpected error occurred. Please try again.",
      code: error.code || "UNKNOWN_ERROR",
      details: error.response?.data,
    };

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      const serverMessage = data?.message || data?.error;

      switch (status) {
        case 400:
          normalizedError.message =
            serverMessage || "Invalid request. Please check input parameters.";
          break;
        case 401:
          normalizedError.message = "Unauthorized access. Please authenticate.";
          break;
        case 403:
          normalizedError.message =
            serverMessage || "Forbidden. You do not have permission.";
          break;
        case 404:
          normalizedError.message =
            serverMessage || "The requested resource was not found.";
          break;
        case 409:
          normalizedError.message =
            serverMessage || "Conflict. Resource already exists or is in invalid state.";
          break;
        case 429:
          normalizedError.message =
            "Too many requests. Please slow down and try again shortly.";
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          normalizedError.message =
            serverMessage || "AWS backend service error. Please try again.";
          break;
        default:
          normalizedError.message =
            serverMessage || `Request failed with status code ${status}.`;
      }
    } else if (error.code === "ECONNABORTED") {
      normalizedError.message =
        "Request timed out waiting for AWS backend response.";
      normalizedError.code = "TIMEOUT";
    } else if (error.request) {
      normalizedError.message =
        "Network error. Unable to reach AWS API Gateway. Check your internet connection or CORS settings.";
      normalizedError.code = "NETWORK_ERROR";
    }

    if (import.meta.env.DEV) {
      console.warn("[API Service]", error.config?.url, normalizedError);
    }

    return Promise.reject(normalizedError);
  }
);

/* ==========================================================================
   TENANT MANAGEMENT
   ========================================================================== */

/**
 * List all tenants.
 * Endpoint: GET /tenants
 */
export async function getTenants() {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 200));
    return { count: mockTenants.length, tenants: [...mockTenants] };
  }
  const response = await apiClient.get("/tenants");
  return response.data;
}

/**
 * Get tenant details by ID.
 * Endpoint: GET /tenants/{tenant_id}
 */
export async function getTenant(tenantId) {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 150));
    const tenant = mockTenants.find((t) => t.tenant_id === tenantId);
    if (!tenant) {
      throw { status: 404, message: `Tenant "${tenantId}" not found.` };
    }
    return tenant;
  }
  const response = await apiClient.get(`/tenants/${encodeURIComponent(tenantId)}`);
  return response.data;
}

/**
 * Provision a new tenant.
 * Endpoint: POST /tenants
 * Payload: { tenant_id }
 * Expected status: 202 Accepted { job_id, tenant_id, status: 'PENDING' }
 */
export async function provisionTenant(tenantId) {
  const cleanId = String(tenantId || "").trim();
  if (!cleanId) {
    throw { status: 400, message: "Tenant ID is required." };
  }

  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 400));
    const exists = mockTenants.some((t) => t.tenant_id === cleanId);
    if (exists) {
      throw { status: 409, message: `Tenant "${cleanId}" already exists.` };
    }
    const newJobId = "job-" + Math.random().toString(36).substring(2, 10);
    const newJob = {
      job_id: newJobId,
      tenant_id: cleanId,
      status: "PENDING",
      stage: "STEP_FUNCTIONS_STARTED",
      environment: "dev",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockJobs.unshift(newJob);

    // Mock progress after 4s
    setTimeout(() => {
      newJob.status = "BOOTSTRAPPING";
      newJob.stage = "BOOTSTRAP_HOST";
      newJob.updated_at = new Date().toISOString();
    }, 4000);
    // Mock ready after 12s
    setTimeout(() => {
      newJob.status = "READY";
      newJob.stage = "READY";
      newJob.updated_at = new Date().toISOString();
      mockTenants.unshift({
        tenant_id: cleanId,
        status: "READY",
        host_id: "host-i-0a812b4e9f301d2a1",
        private_ip: "10.0.1.42",
        mysql_port: 3307,
        database_name: `tenant_${cleanId.replace(/-/g, "_")}_db`,
        mysql_username: `user_${cleanId.replace(/-/g, "_")}`,
        environment: "dev",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }, 12000);

    return {
      message: "Tenant provisioning started",
      tenant_id: cleanId,
      job_id: newJobId,
      status: "PENDING",
    };
  }

  const response = await apiClient.post("/tenants", {
    tenant_id: cleanId,
  });
  return response.data;
}

/**
 * Delete / deprovision a tenant.
 * Endpoint: DELETE /tenants/{tenant_id}
 */
export async function deleteTenant(tenantId) {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 300));
    const idx = mockTenants.findIndex((t) => t.tenant_id === tenantId);
    if (idx !== -1) {
      mockTenants[idx].status = "TERMINATED";
      mockTenants[idx].updated_at = new Date().toISOString();
    }
    return {
      message: "Tenant deprovisioned successfully",
      tenant_id: tenantId,
      status: "TERMINATED",
    };
  }
  const response = await apiClient.delete(`/tenants/${encodeURIComponent(tenantId)}`);
  return response.data;
}

/* ==========================================================================
   DATABASE QUERY
   ========================================================================== */

/**
 * Execute tenant SQL query safely via backend.
 * Endpoint: POST /tenants/{tenant_id}/query
 * Payload: { sql }
 */
export async function queryTenant(tenantId, sql) {
  const cleanSql = String(sql || "").trim();
  if (!cleanSql) {
    throw { status: 400, message: "SQL query cannot be empty." };
  }

  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 300));
    const lower = cleanSql.toLowerCase();
    if (lower.startsWith("select 1")) {
      return {
        message: "SQL executed successfully",
        tenant_id: tenantId,
        database_name: `tenant_${tenantId.replace(/-/g, "_")}_db`,
        affected_rows: 1,
        rows: [{ 1: 1 }],
      };
    }
    if (lower.startsWith("show tables")) {
      return {
        message: "SQL executed successfully",
        tenant_id: tenantId,
        database_name: `tenant_${tenantId.replace(/-/g, "_")}_db`,
        affected_rows: 3,
        rows: [
          { Tables_in_tenant_db: "users" },
          { Tables_in_tenant_db: "orders" },
          { Tables_in_tenant_db: "audit_log" },
        ],
      };
    }
    if (lower.includes("from users")) {
      return {
        message: "SQL executed successfully",
        tenant_id: tenantId,
        database_name: `tenant_${tenantId.replace(/-/g, "_")}_db`,
        affected_rows: 3,
        rows: [
          { id: 1, name: "Alice Admin", email: "alice@example.com", role: "admin", created_at: "2026-09-01 10:00:00" },
          { id: 2, name: "Bob Developer", email: "bob@example.com", role: "developer", created_at: "2026-09-02 11:30:00" },
          { id: 3, name: "Charlie User", email: "charlie@example.com", role: "viewer", created_at: "2026-09-05 14:15:00" },
        ],
      };
    }
    return {
      message: "SQL executed successfully",
      tenant_id: tenantId,
      database_name: `tenant_${tenantId.replace(/-/g, "_")}_db`,
      affected_rows: 1,
      rows: [{ status: "SUCCESS", executed_query: cleanSql.substring(0, 30) + "..." }],
    };
  }

  const response = await apiClient.post(`/tenants/${encodeURIComponent(tenantId)}/query`, {
    sql: cleanSql,
  });
  return response.data;
}

/* ==========================================================================
   BACKUP & RESTORE
   ========================================================================== */

/**
 * Trigger tenant backup via SSM.
 * Endpoint: GET /tenants/{tenant_id}/backup
 * Expected status: 202 Accepted { backup_id, command_id, status: 'IN_PROGRESS' }
 */
export async function backupTenant(tenantId) {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 400));
    const backupId = "backup-" + Math.random().toString(36).substring(2, 10);
    const newBackup = {
      backup_id: backupId,
      tenant_id: tenantId,
      s3_bucket: "multi-tenant-mysql-backups-dev",
      s3_key: `tenants/${tenantId}/${backupId}.sql.gz`,
      size_bytes: 254100,
      created_at: new Date().toISOString(),
      status: "COMPLETED",
    };
    mockBackups.unshift(newBackup);
    return {
      message: "Tenant backup started",
      tenant_id: tenantId,
      backup_id: backupId,
      command_id: "cmd-" + Math.random().toString(36).substring(2, 8),
      s3_bucket: newBackup.s3_bucket,
      s3_key: newBackup.s3_key,
      status: "IN_PROGRESS",
      created_at: new Date().toISOString(),
    };
  }
  const response = await apiClient.get(`/tenants/${encodeURIComponent(tenantId)}/backup`);
  return response.data;
}

/**
 * List backups for a tenant from S3.
 * Endpoint: GET /tenants/{tenant_id}/backups
 */
export async function getTenantBackups(tenantId) {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 150));
    const filtered = mockBackups.filter((b) => b.tenant_id === tenantId);
    return { count: filtered.length, tenant_id: tenantId, backups: filtered };
  }
  const response = await apiClient.get(`/tenants/${encodeURIComponent(tenantId)}/backups`);
  return response.data;
}

/**
 * Restore a tenant database from backup.
 * Endpoint: POST /tenants/{tenant_id}/restore
 * Payload: { backup_id }
 */
export async function restoreTenant(tenantId, backupId) {
  const cleanBackupId = String(backupId || "").trim();
  if (!cleanBackupId) {
    throw { status: 400, message: "Backup ID is required." };
  }

  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 500));
    return {
      message: "Tenant restore started",
      tenant_id: tenantId,
      backup_id: cleanBackupId,
      command_id: "cmd-" + Math.random().toString(36).substring(2, 8),
      status: "IN_PROGRESS",
      created_at: new Date().toISOString(),
    };
  }

  const response = await apiClient.post(`/tenants/${encodeURIComponent(tenantId)}/restore`, {
    backup_id: cleanBackupId,
  });
  return response.data;
}

/* ==========================================================================
   JOBS MANAGEMENT
   ========================================================================== */

/**
 * List all provisioning jobs.
 * Endpoint: GET /jobs
 */
export async function getJobs() {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 200));
    return { count: mockJobs.length, jobs: [...mockJobs] };
  }
  const response = await apiClient.get("/jobs");
  return response.data;
}

/**
 * Get job status by ID.
 * Endpoint: GET /jobs/{job_id}
 */
export async function getJob(jobId) {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 150));
    const job = mockJobs.find((j) => j.job_id === jobId);
    if (!job) {
      throw { status: 404, message: `Job "${jobId}" not found.` };
    }
    return job;
  }
  const response = await apiClient.get(`/jobs/${encodeURIComponent(jobId)}`);
  return response.data;
}

/* ==========================================================================
   HOSTS MANAGEMENT
   ========================================================================== */

/**
 * List all registered EC2 MySQL hosts.
 * Endpoint: GET /hosts
 */
export async function getHosts() {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 200));
    return { count: mockHosts.length, hosts: [...mockHosts] };
  }
  const response = await apiClient.get("/hosts");
  return response.data;
}

/* ==========================================================================
   SYSTEM HEALTH
   ========================================================================== */

/**
 * Check backend system health.
 * Endpoint: GET /health
 */
export async function getSystemHealth() {
  if (isMockDataEnabled()) {
    await new Promise((r) => setTimeout(r, 250));
    return { ...mockHealth, timestamp: new Date().toISOString() };
  }
  const response = await apiClient.get("/health");
  return response.data;
}

/**
 * Connectivity test ping.
 */
export async function checkConnection() {
  const url = getBaseUrl();
  if (!url && !isMockDataEnabled()) {
    return { connected: false, reason: "API Base URL is not configured." };
  }
  try {
    const health = await getSystemHealth();
    return { connected: true, health };
  } catch (err) {
    return { connected: false, error: err.message || "Failed to reach AWS API." };
  }
}

export default apiClient;
