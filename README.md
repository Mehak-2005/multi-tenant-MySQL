# Multi-Tenant MySQL Provisioning Service on AWS

## 1. Project Overview

The Multi-Tenant MySQL Provisioning Service is a serverless AWS-based system that automatically provisions isolated MySQL databases for different tenants.

The system allows a client to create a tenant through an API. The service then:

1. Creates a provisioning job.
2. Finds an available MySQL host.
3. Creates a new EC2 MySQL host when required.
4. Waits until MySQL is fully ready.
5. Creates a separate database and MySQL user for the tenant.
6. Stores credentials securely in AWS Secrets Manager.
7. Stores tenant and job information in DynamoDB.
8. Provides APIs for querying, backup, restore and deletion.

The main goal is to provide tenant isolation while allowing multiple tenants to share the same MySQL EC2 host.

---

## 2. Problem Statement

Traditional database provisioning can require manual infrastructure setup for every customer or application.

This project automates the provisioning process using AWS services.

The system must:

- Provision MySQL hosts on demand.
- Support multiple tenants on the same MySQL host.
- Keep each tenant's database isolated.
- Store database credentials securely.
- Detect when MySQL is actually ready.
- Handle provisioning asynchronously.
- Provide tenant management APIs.
- Support backup and restore operations.
- Provide logging and monitoring.
- Follow AWS security and least-privilege principles.

---

## 3. Objectives

The main objectives of this project are:

- Automate MySQL database provisioning.
- Implement multi-tenant database isolation.
- Reduce manual infrastructure operations.
- Provide asynchronous provisioning.
- Secure database credentials using AWS Secrets Manager.
- Use private networking for MySQL hosts.
- Implement host capacity management.
- Provide tenant lifecycle management.
- Implement monitoring and observability.
- Deploy the complete infrastructure using AWS SAM / CloudFormation.

---

## 4. Main Features

### 4.1 On-Demand MySQL Provisioning

The system can launch an EC2 instance with MySQL installed and configured.

The MySQL server is configured to use a non-default port.

The current MySQL port is:

    3307

The EC2 instance is configured automatically using EC2 user data.

---

### 4.2 Multi-Tenant Support

Multiple tenants can share the same MySQL EC2 host.

Each tenant receives:

- A separate MySQL database.
- A separate MySQL user.
- A unique password.
- Permissions limited to its own database.

Example:

    Tenant A
       |
       +-- tenant_db_A
       +-- tenant_user_A

    Tenant B
       |
       +-- tenant_db_B
       +-- tenant_user_B

Both tenants may run on the same EC2 host while their databases remain logically isolated.

---

### 4.3 Host Capacity Management

Each MySQL host has a configurable tenant capacity.

Before assigning a tenant to a host, the system checks:

- Host status.
- Current tenant count.
- Maximum tenant capacity.

Tenant placement uses an atomic DynamoDB update to reserve a host slot.

If all available hosts are full, the system starts the new-host provisioning flow.

---

### 4.4 MySQL Readiness Detection

The system does not consider an EC2 instance ready simply because its EC2 state is `running`.

It verifies that:

1. MySQL has started.
2. MySQL is accepting connections.
3. The configured MySQL port is available.
4. A database query can successfully execute.

Only after these checks does the host become `READY`.

---

### 4.5 Secure Credential Management

Database passwords are not stored directly in the tenant metadata.

Credentials are stored in:

    AWS Secrets Manager

Secrets are generated for:

- MySQL host administration.
- Individual tenant database users.

The application retrieves the required secret only when it needs to connect to MySQL.

Passwords are not intended to be stored in Lambda environment variables or returned in normal API responses.

---

## 5. AWS Architecture

The project uses the following AWS services:

| AWS Service | Purpose |
|---|---|
| Amazon API Gateway | Provides HTTP APIs |
| AWS Lambda | Runs application logic |
| AWS Step Functions | Orchestrates asynchronous provisioning |
| Amazon EC2 | Hosts MySQL servers |
| Amazon DynamoDB | Stores tenants, jobs and host information |
| AWS Secrets Manager | Stores database credentials |
| Amazon VPC | Provides private networking |
| Amazon CloudWatch | Provides logs and metrics |
| AWS Systems Manager | Used for host management and backup/restore operations |
| AWS SAM / CloudFormation | Infrastructure as Code |

---

## 6. High-Level Architecture

```text
                    Client
                      |
                      v
              Amazon API Gateway
                      |
                      v
                API Lambda
                      |
                      v
              AWS Step Functions
                      |
          +-----------+-----------+
          |                       |
          v                       v
   Host Placement          New Host Required
          |                       |
          |                       v
          |                Host Provisioner
          |                       |
          |                       v
          |                     EC2
          |                       |
          |                 MySQL Installation
          |                       |
          |                       v
          |                 Host Registration
          |                       |
          +-----------+-----------+
                      |
                      v
              Tenant Provisioner
                      |
             +--------+--------+
             |                 |
             v                 v
        MySQL Database    MySQL User
             |
             v
       Tenant-specific
          privileges
```

---

## 7. Web Application Dashboard (React + Vite)

The repository includes a production-grade cloud management web dashboard located in [`frontend/`](frontend/):

```text
Vercel (Frontend Hosting)
        │
        ▼ (HTTPS REST / JSON)
AWS API Gateway
        │
        ▼
AWS Lambda / Step Functions / DynamoDB / EC2 MySQL / Secrets Manager / S3
```

### Dashboard Features
- **Live Infrastructure KPIs**: Dynamic tenant counts, active EC2 hosts, and available capacity.
- **Asynchronous Job Polling**: Visual 6-stage pipeline tracking for Step Functions state machine execution.
- **Tenant Management**: Search, filter, provision, and deprovision tenants.
- **Tenant Details & Credentials**: Safe masked credentials with reveal/copy actions and S3 backup history.
- **In-Browser SQL Console**: Safe query interface communicating strictly over AWS API Gateway.
- **Host Capacity Visualizer**: Real-time progress bars showing slot utilization (`X / 5 tenants`).
- **Disaster Recovery**: AWS SSM-triggered `mysqldump` backups into S3 and confirmed snapshot restore.
- **System Health Monitor**: Live 8-component AWS infrastructure status check.

### Getting Started with Frontend
```bash
cd frontend
npm install
npm run dev
```

For complete frontend setup, architecture details, and Vercel deployment instructions, see [frontend/README.md](frontend/README.md) and [frontend/API_INTEGRATION.md](frontend/API_INTEGRATION.md).
