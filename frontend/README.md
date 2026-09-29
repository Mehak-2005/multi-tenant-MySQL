# Multi-Tenant MySQL Cloud Management Dashboard

A modern, production-grade cloud infrastructure management console built with React, Vite, and Lucide React for the **AWS Multi-Tenant MySQL Provisioning Service**.

The dashboard connects directly to real AWS API Gateway and Lambda endpoints, providing real-time visibility and control over tenant provisioning, EC2 host placement, MySQL database queries, automated S3 backups, snapshot restoration, and infrastructure health monitoring.

---

## 1. Project Overview

This dashboard serves as the administrative frontend for a serverless multi-tenant database provisioning engine on AWS. Instead of running dedicated RDS instances per customer, the system dynamically schedules isolated MySQL schemas across EC2 compute hosts running hardened MySQL instances on non-default port `3307`, managing capacity thresholds (`MaxTenantsPerHost = 5`), credentials encryption via AWS Secrets Manager, and state machine transitions orchestrated by AWS Step Functions.

### Key Capabilities
- **On-Demand Tenant Provisioning**: Trigger asynchronous Step Functions state machine executions.
- **Asynchronous Job Polling & Visual Timeline**: Track provisioning states (`PENDING` → `BOOTSTRAPPING` → `READY` / `FAILED`) with real-time polling against DynamoDB.
- **Dynamic Host Capacity Monitoring**: Visualize EC2 host allocations, tenant density (`X / 5 tenants`), and compute status.
- **Secure SQL Query Console**: Execute permitted SELECT queries over AWS API Gateway without opening direct browser-to-MySQL connections.
- **S3 Snapshot & Disaster Recovery**: Initiate AWS SSM-driven `mysqldump` backups into Amazon S3 and perform confirmed restores with safety dialogs.
- **Deep Infrastructure Health**: Check live operational status of API Gateway, Lambda, DynamoDB, Step Functions, EC2, MySQL, S3, and Secrets Manager.

---

## 2. Frontend Architecture

The frontend is constructed using a decoupled, modular React architecture:

```
frontend/
├── public/                 # Static assets and favicon
├── src/
│   ├── components/         # Reusable design system primitives
│   │   ├── ConfirmModal.jsx    # Dangerous action confirmation modal
│   │   ├── EmptyState.jsx      # Clean zero-data states with actions
│   │   ├── SafeTable.jsx       # Responsive, sortable table with HTML escaping
│   │   ├── Sidebar.jsx         # Collapsible desktop/mobile drawer navigation
│   │   ├── Skeleton.jsx        # Skeleton loaders for cards & tables
│   │   ├── StatusBadge.jsx     # Visual badges for PENDING, BOOTSTRAPPING, etc.
│   │   └── Topbar.jsx          # Live environment, AWS region & breadcrumbs
│   ├── constants/
│   │   └── states.js       # State machine definitions & progress percentages
│   ├── hooks/
│   │   ├── usePolling.js   # Robust async job polling with timeout & cleanup
│   │   └── useToast.jsx    # Toast notification system
│   ├── layouts/
│   │   └── AppLayout.jsx   # Master layout wrapping sidebar, topbar, & alerts
│   ├── pages/              # 12 Core feature pages
│   │   ├── Dashboard.jsx       # Aggregated KPIs, recent activity, system health
│   │   ├── Tenants.jsx         # Searchable, filterable tenant management table
│   │   ├── TenantDetails.jsx   # Deep dive, masked credentials, backup history
│   │   ├── ProvisionTenant.jsx # Provisioning submission form & pipeline guide
│   │   ├── Jobs.jsx            # Provisioning jobs table with status filters
│   │   ├── JobDetails.jsx      # Visual 6-stage timeline with live polling
│   │   ├── QueryDatabase.jsx   # SQL query execution console & table viewer
│   │   ├── Hosts.jsx           # EC2 host density & slot capacity tracker
│   │   ├── Backups.jsx         # S3 backups manager & SSM trigger
│   │   ├── Restore.jsx         # Database restoration with overwrite confirmation
│   │   ├── SystemHealth.jsx    # 8-point AWS component health monitor
│   │   └── Settings.jsx        # API endpoint config, live ping test, mock switch
│   ├── services/
│   │   ├── api.js          # Centralized Axios service with error normalization
│   │   └── mockData.js     # Isolated offline development fallback data
│   ├── utils/
│   │   └── formatters.js   # Date, duration, relative time, and bytes formatters
│   ├── App.jsx             # React Router routing configuration
│   ├── App.css             # Dark Navy & Slate design system
│   ├── index.css           # Global CSS variables & resets
│   └── main.jsx            # React root entry point
├── vercel.json             # Vercel SPA routing rewrite rules
├── vite.config.js          # Vite configuration
└── package.json            # Dependencies and scripts
```

---

## 3. Installation

### Prerequisites
- Node.js `18.x` or `20.x` or later
- npm `9.x` or later

### Install Dependencies
```bash
cd frontend
npm install
```

---

## 4. Environment Variables

Create `.env` inside `frontend/` (or configure in the Vercel dashboard for production):

```ini
# Real AWS API Gateway endpoint URL (SAM Stack Output)
VITE_API_BASE_URL=https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/Prod

# AWS Region where SAM stack is deployed
VITE_AWS_REGION=ap-south-1

# Deployment environment label
VITE_ENVIRONMENT=dev

# Mock data switch (MUST be false for real AWS backend)
VITE_USE_MOCK_DATA=false
```

> **Security Note**: Never place AWS access keys, secret keys, or database root passwords in frontend environment variables. Only safe, public endpoint configuration variables prefixed with `VITE_` should be defined.

---

## 5. Local Development

Start the local Vite development server:

```bash
npm run dev
```

The application will launch at `http://localhost:5173`.

### Development Options
- **Live AWS Backend**: Point `VITE_API_BASE_URL` to your live API Gateway URL.
- **Offline / Sandbox**: Set `VITE_USE_MOCK_DATA=true` or switch the toggle in the `/settings` page to simulate backend states without active AWS credentials.

---

## 6. AWS API Configuration

When your SAM application is deployed with:

```bash
sam deploy
```

The SAM template outputs the live API Gateway endpoint:

```
Key: TenantApiUrl
Value: https://abcdef1234.execute-api.ap-south-1.amazonaws.com/Prod
```

Set this exact URL as `VITE_API_BASE_URL` in your frontend environment.

---

## 7. API Endpoint Mapping

All browser communication goes through the centralized API client in [`src/services/api.js`](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/src/services/api.js):

| Frontend Action | HTTP Method | Backend Endpoint | Asynchronous? |
| :--- | :---: | :--- | :---: |
| List Tenants | `GET` | `/tenants` | No |
| Provision Tenant | `POST` | `/tenants` | **Yes (Returns 202 + `job_id`)** |
| Get Tenant Details | `GET` | `/tenants/{tenant_id}` | No |
| Terminate / Deprovision | `DELETE` | `/tenants/{tenant_id}` | No |
| Execute SQL Query | `POST` | `/tenants/{tenant_id}/query` | No |
| Trigger Backup | `POST` | `/tenants/{tenant_id}/backup` | **Yes (SSM RunCommand)** |
| List Backups | `GET` | `/tenants/{tenant_id}/backups` | No |
| Restore from S3 | `POST` | `/tenants/{tenant_id}/restore` | **Yes (SSM RunCommand)** |
| List Provisioning Jobs | `GET` | `/jobs` | No |
| Get Job Status & Stage | `GET` | `/jobs/{job_id}` | Polled every 3s |
| List EC2 Hosts & Capacity | `GET` | `/hosts` | No |
| System Health Checks | `GET` | `/health` | No |

---

## 8. Vercel Deployment

The frontend is fully configured to deploy on Vercel as a standalone Single-Page Application (SPA) while your backend continues running on AWS serverless infrastructure.

### Deployment via Vercel CLI
```bash
# Install Vercel CLI
npm install -g vercel

# From the repository root:
vercel --cwd frontend
```

### Deployment via Vercel Web Dashboard
1. Link your GitHub repository (`multi-tenant-mysql`).
2. Set **Root Directory** to `frontend`.
3. Framework Preset: **Vite**.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.
6. Add Environment Variable:
   - `VITE_API_BASE_URL` = `https://<api-id>.execute-api.ap-south-1.amazonaws.com/Prod`
   - `VITE_AWS_REGION` = `ap-south-1`
   - `VITE_ENVIRONMENT` = `production`
   - `VITE_USE_MOCK_DATA` = `false`
7. Click **Deploy**.

The included [`frontend/vercel.json`](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/frontend/vercel.json) handles client-side routing rewrites so deep links like `/jobs/job-123` or `/tenants/tenant-abc/query` resolve correctly without HTTP 404s.

---

## 9. Troubleshooting

### Issue: CORS Errors in Browser Console
- **Cause**: Preflight `OPTIONS` requests fail or origin is blocked.
- **Solution**: The SAM template [`template.yaml`](file:///c:/Users/Admin/OneDrive/Desktop/TeamGeeks%20Solutions/Task3/multi-tenant-mysql/template.yaml) includes global CORS headers and Lambda returns `Access-Control-Allow-Origin: *` with headers `Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token`. Ensure your deployed Lambda has the updated `tenant_api.py`.

### Issue: Provisioning Job Remains in `PENDING`
- **Cause**: Step Functions execution has not triggered or EC2 instance creation is provisioning.
- **Solution**: Check AWS Step Functions Console for execution status. Ensure EC2 IAM instance profiles have SSM and Secrets Manager permissions.

### Issue: "Network Error" on API Calls
- **Cause**: `VITE_API_BASE_URL` is incorrect or missing trailing `/Prod` stage.
- **Solution**: Go to the **Settings** view in the dashboard, enter your exact API Gateway URL, and click **Ping API Endpoint** to test connectivity.

---

## 10. Security Notes

1. **Zero Database Exposure**: The browser never opens TCP sockets to MySQL port `3307` or connects directly to EC2. All queries and operations are routed through authenticated API Gateway endpoints.
2. **Secrets Manager Masking**: Database passwords are never exposed in query strings or plain text. In Tenant Details, passwords are masked by default and only revealed upon explicit user interaction.
3. **No Direct AWS SDK Keys**: Browser code does not contain AWS Access Keys, IAM Secret Keys, or Session Tokens.
4. **Input Sanitization**: Tables sanitize all data before rendering, and user query strings are strictly checked on the backend to prohibit unauthorized destructive commands.
