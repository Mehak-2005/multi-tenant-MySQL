export const JOB_STATES = {
  PENDING: "PENDING",
  BOOTSTRAPPING: "BOOTSTRAPPING",
  READY: "READY",
  FAILED: "FAILED",
  TERMINATED: "TERMINATED",
};

export const TENANT_STATES = {
  PENDING: "PENDING",
  BOOTSTRAPPING: "BOOTSTRAPPING",
  READY: "READY",
  FAILED: "FAILED",
  TERMINATED: "TERMINATED",
};

export const STATUS_CONFIG = {
  PENDING: {
    label: "Pending",
    color: "#9683C8",
    bg: "#F2EFFA",
    border: "#B4A2EA",
    progress: 15,
    description: "Request received, queueing orchestration workflow.",
  },
  BOOTSTRAPPING: {
    label: "Bootstrapping",
    color: "#D17BD1",
    bg: "#FBEFFB",
    border: "#EDA3ED",
    progress: 60,
    description: "Allocating host, starting EC2, verifying MySQL readiness.",
  },
  READY: {
    label: "Ready",
    color: "#10b981",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    progress: 100,
    description: "Database and tenant user provisioned. Accepting queries.",
  },
  FAILED: {
    label: "Failed",
    color: "#CC395D",
    bg: "#FDF2F5",
    border: "#E1A4B3",
    progress: 100,
    description: "Provisioning encountered an error. Slot released.",
  },
  TERMINATED: {
    label: "Terminated",
    color: "#451345",
    bg: "#F2EFFA",
    border: "#D8CEEA",
    progress: 100,
    description: "Tenant deprovisioned. Database and user removed.",
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "#9683C8",
    bg: "#F2EFFA",
    border: "#B4A2EA",
    progress: 50,
    description: "Operation currently executing via AWS Systems Manager.",
  },
  COMPLETED: {
    label: "Completed",
    color: "#10b981",
    bg: "#ecfdf5",
    border: "#a7f3d0",
    progress: 100,
    description: "Operation completed successfully.",
  },
};

export const PROVISIONING_STAGES = [
  {
    key: "API_REQUEST",
    title: "1. Request Received",
    description: "API Gateway validated input and registered job record.",
  },
  {
    key: "STEP_FUNCTIONS_STARTED",
    title: "2. Workflow Started",
    description: "Step Functions state machine execution initialized.",
  },
  {
    key: "FIND_RESERVE_HOST",
    title: "3. Host Placement",
    description: "DynamoDB atomic capacity reservation on MySQL host.",
  },
  {
    key: "BOOTSTRAP_HOST",
    title: "4. EC2 / MySQL Bootstrap",
    description: "Launching EC2 host or utilizing existing ready host.",
  },
  {
    key: "READINESS_CHECK",
    title: "5. MySQL Readiness",
    description: "Verified MySQL accepting connections on port 3307.",
  },
  {
    key: "TENANT_PROVISION",
    title: "6. Database Configured",
    description: "Dedicated database, user, and Secrets Manager entry created.",
  },
  {
    key: "READY",
    title: "7. Tenant Ready",
    description: "Tenant is active, isolated, and accessible.",
  },
];

export const DEFAULT_MYSQL_PORT = 3307;
export const DEFAULT_MAX_TENANTS_PER_HOST = 5;
export const DEFAULT_REGION = "ap-south-1";
export const DEFAULT_ENV = "dev";
