# AWS Multi-Tenant MySQL API Integration Specification

This document details the interface contracts between the **React Frontend** and the **AWS Serverless Backend** (`API Gateway` + `AWS Lambda`).

All API requests are prefixed with the base URL provided via environment variable:
```
Base URL: ${VITE_API_BASE_URL}
Example:  https://abcdef1234.execute-api.ap-south-1.amazonaws.com/Prod
```

---

## Centralized Client Architecture

All requests are dispatched through [`src/services/api.js`](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/services/api.js) via Axios with default timeouts (15s for standard operations, 30s for SQL queries), automatic JSON content handling, and unified error parsing.

---

## API Endpoints Catalog

### 1. List Tenants
- **Endpoint**: `GET /tenants`
- **Frontend Page**: [Tenants](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Tenants.jsx), [Dashboard](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Dashboard.jsx), [Backups](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Backups.jsx), [Restore](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Restore.jsx)
- **Request Headers**:
  - `Accept: application/json`
- **Request Body**: None
- **Success Response (200 OK)**:
  ```json
  [
    {
      "tenant_id": "tenant-alpha",
      "status": "READY",
      "host_id": "host-i-0a1b2c3d4e5f67890",
      "db_name": "db_tenant_alpha",
      "db_user": "usr_tenant_alpha",
      "mysql_port": 3307,
      "created_at": "2026-09-29T08:30:00Z",
      "updated_at": "2026-09-29T08:35:12Z"
    }
  ]
  ```
- **Error Responses**:
  - `500 Internal Server Error`: `{"error": "Failed to scan tenants"}`

---

### 2. Provision Tenant (Asynchronous)
- **Endpoint**: `POST /tenants`
- **Frontend Page**: [Provision Tenant](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/ProvisionTenant.jsx)
- **Request Headers**:
  - `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "tenant_id": "tenant-corp-42",
    "db_name": "db_tenant_corp_42",
    "db_user": "usr_tenant_corp_42"
  }
  ```
- **Success Response (202 Accepted)**:
  ```json
  {
    "message": "Tenant provisioning started",
    "job_id": "job-f8a92b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "tenant_id": "tenant-corp-42",
    "status": "PENDING"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"error": "tenant_id is required"}` or invalid alphanumeric characters.
  - `409 Conflict`: `{"error": "Tenant already exists"}`
  - `500 Internal Server Error`: `{"error": "Failed to start Step Functions execution"}`

---

### 3. Get Tenant Details
- **Endpoint**: `GET /tenants/{tenant_id}`
- **Frontend Page**: [Tenant Details](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/TenantDetails.jsx)
- **Path Parameters**:
  - `tenant_id` (string): Alphanumeric tenant identifier.
- **Success Response (200 OK)**:
  ```json
  {
    "tenant_id": "tenant-alpha",
    "status": "READY",
    "host_id": "host-i-0a1b2c3d4e5f67890",
    "db_name": "db_tenant_alpha",
    "db_user": "usr_tenant_alpha",
    "private_ip": "10.0.1.45",
    "mysql_port": 3307,
    "credentials_secret_arn": "arn:aws:secretsmanager:ap-south-1:123456789012:secret:tenant/tenant-alpha/credentials",
    "created_at": "2026-09-29T08:30:00Z",
    "updated_at": "2026-09-29T08:35:12Z"
  }
  ```
- **Error Responses**:
  - `404 Not Found`: `{"error": "Tenant not found"}`

---

### 4. Deprovision / Terminate Tenant
- **Endpoint**: `DELETE /tenants/{tenant_id}`
- **Frontend Page**: [Tenants](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Tenants.jsx), [Tenant Details](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/TenantDetails.jsx)
- **Path Parameters**:
  - `tenant_id` (string): Tenant identifier.
- **Success Response (200 OK)**:
  ```json
  {
    "message": "Tenant tenant-alpha deprovisioned successfully",
    "tenant_id": "tenant-alpha",
    "status": "TERMINATED"
  }
  ```
- **Error Responses**:
  - `404 Not Found`: `{"error": "Tenant not found"}`
  - `500 Internal Server Error`: `{"error": "Failed to clean up tenant resources"}`

---

### 5. Execute SQL Query
- **Endpoint**: `POST /tenants/{tenant_id}/query`
- **Frontend Page**: [Database Query](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/QueryDatabase.jsx)
- **Path Parameters**:
  - `tenant_id` (string): Tenant identifier.
- **Request Body**:
  ```json
  {
    "sql": "SELECT id, username, email FROM users LIMIT 10;"
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "status": "SUCCESS",
    "columns": ["id", "username", "email"],
    "rows": [
      {"id": 1, "username": "admin", "email": "admin@example.com"},
      {"id": 2, "username": "operator", "email": "ops@example.com"}
    ],
    "row_count": 2,
    "affected_rows": 0,
    "execution_time_ms": 14.8
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"error": "Only SELECT or SHOW statements are permitted"}`
  - `404 Not Found`: `{"error": "Tenant not found or not in READY state"}`
  - `500 Internal Server Error`: `{"error": "MySQL query execution error: Unknown column 'xyz'"}`

---

### 6. Trigger S3 Tenant Backup
- **Endpoint**: `POST /tenants/{tenant_id}/backup`
- **Frontend Page**: [Backups](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Backups.jsx), [Tenant Details](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/TenantDetails.jsx)
- **Request Body**: Optional `{}`
- **Success Response (200 OK)**:
  ```json
  {
    "message": "Backup started",
    "backup_id": "backup-tenant-alpha-1759134000",
    "tenant_id": "tenant-alpha",
    "command_id": "b3e05a81-9b1c-4b67-8547-1941295b9c2b",
    "s3_bucket": "multi-tenant-mysql-backups-123456789012",
    "s3_key": "backups/tenant-alpha/backup-tenant-alpha-1759134000.sql.gz",
    "status": "IN_PROGRESS"
  }
  ```
- **Error Responses**:
  - `404 Not Found`: `{"error": "Tenant not found"}`
  - `500 Internal Server Error`: `{"error": "Failed to send SSM command to EC2 host"}`

---

### 7. List Tenant Backups
- **Endpoint**: `GET /tenants/{tenant_id}/backups`
- **Frontend Page**: [Backups](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Backups.jsx), [Restore](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Restore.jsx), [Tenant Details](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/TenantDetails.jsx)
- **Success Response (200 OK)**:
  ```json
  [
    {
      "backup_id": "backup-tenant-alpha-1759134000",
      "tenant_id": "tenant-alpha",
      "s3_key": "backups/tenant-alpha/backup-tenant-alpha-1759134000.sql.gz",
      "s3_bucket": "multi-tenant-mysql-backups-123456789012",
      "size_bytes": 1048576,
      "created_at": "2026-09-29T09:00:00Z",
      "status": "COMPLETED"
    }
  ]
  ```

---

### 8. Restore Tenant from S3 Snapshot
- **Endpoint**: `POST /tenants/{tenant_id}/restore`
- **Frontend Page**: [Restore](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Restore.jsx)
- **Request Body**:
  ```json
  {
    "backup_id": "backup-tenant-alpha-1759134000",
    "s3_key": "backups/tenant-alpha/backup-tenant-alpha-1759134000.sql.gz"
  }
  ```
- **Success Response (200 OK)**:
  ```json
  {
    "message": "Restore initiated",
    "tenant_id": "tenant-alpha",
    "backup_id": "backup-tenant-alpha-1759134000",
    "command_id": "c4d16b92-0a2d-5c78-9658-2052306c0d3c",
    "status": "IN_PROGRESS"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"error": "backup_id is required"}`
  - `404 Not Found`: `{"error": "Tenant or backup not found"}`

---

### 9. List Provisioning Jobs
- **Endpoint**: `GET /jobs`
- **Frontend Page**: [Jobs](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Jobs.jsx), [Dashboard](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Dashboard.jsx)
- **Success Response (200 OK)**:
  ```json
  [
    {
      "job_id": "job-f8a92b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
      "tenant_id": "tenant-corp-42",
      "job_type": "PROVISION",
      "status": "READY",
      "stage": "READY",
      "created_at": "2026-09-29T10:00:00Z",
      "updated_at": "2026-09-29T10:02:45Z"
    }
  ]
  ```

---

### 10. Get Job Status (Polling)
- **Endpoint**: `GET /jobs/{job_id}`
- **Frontend Page**: [Job Details](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/JobDetails.jsx)
- **Success Response (200 OK)**:
  ```json
  {
    "job_id": "job-f8a92b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "tenant_id": "tenant-corp-42",
    "status": "BOOTSTRAPPING",
    "stage": "BOOTSTRAP_HOST",
    "host_id": "host-i-0a1b2c3d4e5f67890",
    "created_at": "2026-09-29T10:00:00Z",
    "updated_at": "2026-09-29T10:01:30Z",
    "error": null
  }
  ```
- **Error Responses**:
  - `404 Not Found`: `{"error": "Job not found"}`

---

### 11. List EC2 Hosts & Capacity
- **Endpoint**: `GET /hosts`
- **Frontend Page**: [Hosts](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Hosts.jsx), [Dashboard](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Dashboard.jsx)
- **Success Response (200 OK)**:
  ```json
  [
    {
      "host_id": "host-i-0a1b2c3d4e5f67890",
      "instance_id": "i-0a1b2c3d4e5f67890",
      "private_ip": "10.0.1.45",
      "az": "ap-south-1a",
      "region": "ap-south-1",
      "status": "READY",
      "mysql_status": "RUNNING",
      "mysql_port": 3307,
      "tenant_count": 3,
      "capacity": 5,
      "available_capacity": 2,
      "created_at": "2026-09-29T07:00:00Z"
    }
  ]
  ```

---

### 12. System Health Status
- **Endpoint**: `GET /health`
- **Frontend Page**: [System Health](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/SystemHealth.jsx), [Dashboard](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/pages/Dashboard.jsx), [Topbar](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/components/Topbar.jsx)
- **Success Response (200 OK)**:
  ```json
  {
    "status": "HEALTHY",
    "timestamp": "2026-09-29T11:00:00Z",
    "services": {
      "api_gateway": {"status": "HEALTHY", "message": "API responding normally"},
      "lambda": {"status": "HEALTHY", "message": "Execution runtime healthy"},
      "dynamodb": {"status": "HEALTHY", "message": "Tables accessible"},
      "step_functions": {"status": "HEALTHY", "message": "State machine configured"},
      "ec2_hosts": {"status": "HEALTHY", "message": "Hosts active", "active_hosts": 2},
      "mysql": {"status": "HEALTHY", "message": "MySQL port 3307 active"},
      "s3": {"status": "HEALTHY", "message": "Backup bucket online"},
      "secrets_manager": {"status": "HEALTHY", "message": "Secret storage operational"}
    }
  }
  ```

---

## State Machine Transition Progression

Provisioning jobs reflect the lifecycle orchestrated by AWS Step Functions:

```
[ PENDING ] (15%)
    │
    ▼
[ BOOTSTRAPPING ] (60%) ───► Host Placement, EC2 Launch, MySQL Port 3307 Check
    │
    ├────────────────────────┐
    ▼                        ▼
[ READY ] (100%)       [ FAILED ] (100%)
    │
    ▼
[ TERMINATED ] (100%)
```
