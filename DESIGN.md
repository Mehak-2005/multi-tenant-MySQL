DESIGN.md

Multi-Tenant MySQL Provisioning Service

1. System Overview

This system is an AWS-based multi-tenant MySQL provisioning platform.

A client sends a request to create a tenant through API Gateway. The
request is handled by a Lambda function and starts an asynchronous Step
Functions workflow.

The workflow either places the tenant on an existing MySQL host with
available capacity or provisions a new EC2 MySQL host.

Each tenant receives: - A dedicated MySQL database. - A dedicated MySQL
user. - A unique password. - Database-scoped permissions. - Credentials
stored in AWS Secrets Manager.

Tenant, host, and job state are persisted in DynamoDB.

2. Architecture

Client
  |
  v
API Gateway
  |
  v
Tenant API Lambda
  |
  v
AWS Step Functions
  |
  +----------------------+
  |                      |
  v                      v
Find/Reserve Host     Provision New Host
  |                      |
  |                      v
  |                  EC2 Instance
  |                      |
  |                  MySQL Setup
  |                      |
  |                      v
  |                 Host Registration
  |                      |
  +----------+-----------+
             |
             v
      Tenant Provisioner
             |
       +-----+-----+
       |           |
       v           v
  MySQL DB     MySQL User
       |
       v
Secrets Manager + DynamoDB

3. Main AWS Components

API Gateway

Exposes the public HTTP API for tenant and host operations.

Lambda

Runs API, provisioning, placement, query, backup, restore, and
deprovisioning logic.

Step Functions

Coordinates asynchronous provisioning, branching, retries, and failure
handling.

EC2

Runs the MySQL database hosts.

DynamoDB

Stores tenant, job, and host metadata.

Secrets Manager

Stores MySQL host and tenant credentials.

VPC

Provides private networking for the MySQL hosts.

CloudWatch

Provides logs and application metrics.

Systems Manager

Provides host management and backup/restore command execution.

4. Tenant Provisioning Flow

Step 1: Create Tenant

The client sends POST /tenants.

The API creates a job and starts the Step Functions workflow. The client
receives a job_id immediately.

Step 2: Find an Available Host

The workflow checks the Hosts table for a READY host whose tenant
count is below capacity.

A host slot is reserved atomically in DynamoDB to prevent race
conditions.

Step 3: Provision a New Host

If no host has capacity, the host provisioner launches an EC2 instance
with the required subnet, security group, IAM profile, and user-data.

Step 4: Bootstrap MySQL

The user-data script installs and configures MySQL, uses port 3307,
creates the host administration account, applies hardening, and waits
for MySQL readiness.

Step 5: Verify Readiness

EC2 being running is not sufficient. The system verifies that MySQL
accepts connections and that a query such as SELECT 1 succeeds before
marking the host READY.

5. Host Capacity and Placement

Each host has a configurable tenant capacity.

Example:

Capacity = 6
Tenant count = 5
Available capacity = 1

When the tenant count reaches the capacity, the host is full and a new
host is considered.

The placement operation uses an atomic DynamoDB update with conditions
on host status and capacity.

6. Tenant Isolation

Each tenant receives a separate database and MySQL user.

tenant_user_A -> tenant_db_A
tenant_user_B -> tenant_db_B

The tenant user receives privileges only on its own database.

The query API adds application-level protection against cross-database
access and host-level administrative SQL.

This provides defense in depth:

Application security
        +
MySQL permission security
        =
Tenant isolation

7. Secret Management

Credentials are stored in AWS Secrets Manager.

DynamoDB stores tenant metadata and the secret reference rather than the
plaintext password.

Secrets should not be hard-coded, placed in Lambda environment
variables, printed in logs, or returned unnecessarily through APIs.

8. State Management

The Jobs table stores provisioning state.

PENDING
   |
   v
BOOTSTRAPPING
   |
   v
READY

Failure paths include:

PENDING --------> FAILED
BOOTSTRAPPING --> FAILED
READY ----------> TERMINATED

9. Step Functions Workflow

The workflow is approximately:

Start
  |
Update Job -> BOOTSTRAPPING
  |
Find and Reserve Host
  |
  +---- Existing Host ----> Provision Tenant
  |
  +---- No Host ----------> Provision EC2
                                |
                                v
                         Register Host
                                |
                                v
                         Reserve Slot
                                |
                                v
                         Provision Tenant
                                |
                                v
                         Get Tenant Record
                                |
                                v
                         Mark Job READY

Failures release a reserved slot where appropriate and mark the job
FAILED.

10. API Layer

The API Lambda handles:

Method   Endpoint                  Purpose

POST     /tenants                Create a tenant
GET      /tenants/{id}           Get tenant details
DELETE   /tenants/{id}           Delete a tenant
GET      /jobs/{id}              Get job status
POST     /tenants/{id}/query     Execute tenant SQL
GET      /tenants/{id}/backup    Tenant backup
POST     /tenants/{id}/restore   Tenant restore
GET      /hosts                  Host and capacity information

11. Query Security

The query API validates SQL before execution.

It checks query length, comments, multiple statements, restricted
administrative commands, explicit cross-database references, and tenant
database scope.

Restricted examples include:

GRANT ...
REVOKE ...
CREATE USER ...
DROP USER ...
ALTER USER ...
USE ...
SET GLOBAL ...
SHUTDOWN
FLUSH PRIVILEGES

A query referencing another tenant database is rejected.

The MySQL user's database-scoped permissions provide a second security
layer.

12. Deprovisioning Flow

Tenant deletion follows this general flow:

DELETE /tenants/{id}
          |
          v
Tenant Deprovisioner
          |
          +--> Drop tenant database
          |
          +--> Remove tenant MySQL user
          |
          +--> Delete credentials secret
          |
          +--> Update tenant status
          |
          v
       TERMINATED

Host capacity is released after the tenant is removed.

13. Backup and Restore

Backup and restore identify the tenant's host from stored metadata and
use AWS Systems Manager to perform operations on the correct MySQL host.

This avoids exposing MySQL administration directly to the public
internet.

14. Network Security

MySQL hosts run in private subnets.

The MySQL security group permits MySQL traffic on port 3307 from the
authorized application security group rather than unrestricted public
sources.

Conceptually:

Lambda Security Group
        |
        | TCP 3307
        v
MySQL Security Group
        |
        v
Private EC2 MySQL Host

15. IAM Design

IAM permissions are separated according to Lambda responsibility.

Host provisioning receives EC2 and required infrastructure permissions.

Tenant provisioning receives only the DynamoDB, Secrets Manager, and
logging permissions it needs.

Query handling receives tenant metadata/secret access required for
database connections.

Deprovisioning receives the permissions needed for tenant cleanup and
restricted infrastructure lifecycle operations.

Resource restrictions and resource tags are used where appropriate.

16. Observability

The observability module produces structured JSON logs and CloudWatch
metrics.

Important metrics include:

provision_duration_ms
active_tenants
failed_provisions

Sensitive credentials and raw SQL should not be written to logs.

17. Failure Handling

EC2 Provisioning Failure

EC2 launch fails
       |
       v
Step Functions catches failure
       |
       v
Job = FAILED

MySQL Readiness Failure

Readiness retries exhausted
       |
       v
Provisioning failure
       |
       v
Job = FAILED

Tenant Provisioning Failure

Tenant provisioning failure
       |
       v
Release reserved host slot
       |
       v
Job = FAILED

18. Infrastructure as Code

The AWS infrastructure is defined in:

template.yaml

AWS SAM / CloudFormation creates and configures the infrastructure.

Typical commands are:

sam build
sam validate --lint
sam deploy

19. Testing Strategy

Testing includes API testing with Postman, AWS CLI verification,
DynamoDB verification, EC2 verification, Step Functions execution
history, CloudWatch logs, MySQL connectivity checks, and SQL security
tests.

Security tests include valid queries such as:

SELECT 1;

and rejected operations such as cross-database access and administrative
statements.

20. Design Decisions

Why Lambda?

Lambda provides managed, event-driven execution without maintaining a
continuously running API server.

Why Step Functions?

Provisioning contains multiple dependent and potentially long-running
steps, so Step Functions provides workflow orchestration, retries,
branching, and failure handling.

Why DynamoDB?

DynamoDB provides managed persistence for tenant, job, and host
metadata.

Why EC2 for MySQL?

The project requires controllable MySQL hosts that can be provisioned
and shared between tenants.

Why Secrets Manager?

Database credentials are sensitive and should be separated from
application source code and ordinary configuration.

Why Private Networking?

Database services should not be directly exposed to unrestricted public
network traffic.

21. Current Limitations

The following areas still require additional verification or
improvement:

Full backup and restore end-to-end testing.

Expanded automated integration tests.

Completion of the failure-rate CloudWatch alarm.

New-host end-to-end testing when sufficient EC2 vCPU quota is
available.

Ensuring required host administration privileges are created
automatically during every new host bootstrap.

22. Future Improvements

Possible improvements include:

Automated host cleanup.

Automatic host replacement.

Better capacity metrics.

Additional CloudWatch alarms.

Automated integration testing in CI/CD.

API authentication and authorization.

Rate limiting.

Backup retention policies.

Additional MySQL health checks.

Support for multiple MySQL versions.

Utilization-based host placement.

23. Summary

The system separates the API, orchestration, placement, infrastructure,
database, security, and observability responsibilities.

The resulting architecture provides automated tenant provisioning,
tenant isolation, asynchronous workflow execution, private MySQL
networking, secure credential storage, host capacity management, tenant
lifecycle management, and monitoring.