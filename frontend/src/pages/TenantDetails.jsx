import { useState, useEffect, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  Terminal,
  DatabaseBackup,
  RotateCcw,
  Trash2,
  Copy,
  Check,
  Eye,
  EyeOff,
  ShieldAlert,
  Server,
  Database,
  Lock,
  Layers,
  Key,
} from "lucide-react";
import {
  getTenant,
  getTenantBackups,
  backupTenant,
  deleteTenant,
  getJobs,
} from "../services/api";
import StatusBadge from "../components/StatusBadge";
import ConfirmModal from "../components/ConfirmModal";
import { SkeletonCard } from "../components/Skeleton";
import { formatDate, formatRelativeTime, formatBytes } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function TenantDetails() {
  const { tenantId } = useParams();
  const [tenant, setTenant] = useState(null);
  const [backups, setBackups] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Sensitive reveal / copy states
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  // Terminate Modal
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [terminating, setTerminating] = useState(false);

  // Backup In-Progress
  const [backingUp, setBackingUp] = useState(false);

  const toast = useToast();
  const navigate = useNavigate();

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const [tenantData, backupsData, jobsData] = await Promise.allSettled([
        getTenant(tenantId),
        getTenantBackups(tenantId),
        getJobs(),
      ]);

      if (tenantData.status === "fulfilled") {
        setTenant(tenantData.value);
      } else {
        toast.error("Unable to load tenant details from AWS.");
      }

      if (backupsData.status === "fulfilled") {
        setBackups(backupsData.value?.backups || []);
      }

      if (jobsData.status === "fulfilled") {
        const allJobs = jobsData.value?.jobs || [];
        setJobs(allJobs.filter((j) => j.tenant_id === tenantId));
      }
    } catch {
      toast.error("Error loading tenant information.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCopy = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success("Copied to clipboard.");
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  };

  const handleTriggerBackup = async () => {
    setBackingUp(true);
    try {
      const res = await backupTenant(tenantId);
      toast.success(
        `Backup initiated (ID: ${res.backup_id?.substring(0, 8)}...). Running via AWS SSM.`
      );
      await loadData(true);
    } catch (err) {
      toast.error(err.message || "Failed to trigger backup.");
    } finally {
      setBackingUp(false);
    }
  };

  const handleConfirmTerminate = async () => {
    setTerminating(true);
    try {
      await deleteTenant(tenantId);
      toast.success(`Tenant "${tenantId}" deprovisioned.`);
      setShowTerminateModal(false);
      navigate("/tenants");
    } catch (err) {
      toast.error(err.message || "Failed to deprovision tenant.");
    } finally {
      setTerminating(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <SkeletonCard count={3} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="page-container">
        <div className="dashboard-card text-center p-8">
          <h3>Tenant Not Found</h3>
          <p className="text-muted mt-2">
            The tenant &quot;{tenantId}&quot; could not be retrieved from DynamoDB.
          </p>
          <Link to="/tenants" className="primary-button mt-4 inline-flex">
            Return to Tenants
          </Link>
        </div>
      </div>
    );
  }

  const isReady = tenant.status === "READY";
  const privateIp = tenant.private_ip || "10.0.1.42";
  const port = tenant.mysql_port || 3307;
  const dbName = tenant.database_name || `tenant_${tenant.tenant_id.replace(/-/g, "_")}_db`;
  const username = tenant.mysql_username || `user_${tenant.tenant_id.replace(/-/g, "_")}`;

  const cliConnectionString = `mysql -h ${privateIp} -P ${port} -u ${username} -p ${dbName}`;

  return (
    <div className="tenant-details-page page-container">
      {/* Back button */}
      <div className="mb-4">
        <Link to="/tenants" className="back-link">
          <ArrowLeft size={16} />
          <span>Back to Tenants</span>
        </Link>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="page-title">{tenant.tenant_id}</h1>
            <StatusBadge status={tenant.status} size="md" />
          </div>
          <p className="page-subtitle">
            Database scope: <span className="font-mono text-sm">{dbName}</span>
          </p>
        </div>

        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => loadData(true)}
            disabled={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
          <button
            className="secondary-button"
            disabled={!isReady}
            onClick={() => navigate(`/tenants/${encodeURIComponent(tenantId)}/query`)}
            title={isReady ? "Execute SQL query" : "Available when READY"}
          >
            <Terminal size={15} />
            <span>Query Console</span>
          </button>
          <button
            className="secondary-button"
            disabled={!isReady || backingUp}
            onClick={handleTriggerBackup}
            title={isReady ? "Run mysqldump backup via SSM" : "Available when READY"}
          >
            <DatabaseBackup size={15} />
            <span>{backingUp ? "Starting..." : "Backup Now"}</span>
          </button>
          <button
            className="danger-button"
            disabled={tenant.status === "TERMINATED"}
            onClick={() => setShowTerminateModal(true)}
          >
            <Trash2 size={15} />
            <span>Deprovision</span>
          </button>
        </div>
      </div>

      {/* Top Grid: Overview, Host, DB */}
      <div className="tenant-overview-grid">
        {/* Card 1: Overview */}
        <div className="dashboard-card">
          <div className="card-title-group mb-3">
            <Layers size={18} className="text-blue" />
            <h3>Tenant Overview</h3>
          </div>
          <div className="metadata-list">
            <div className="metadata-row">
              <span className="metadata-label">Tenant ID</span>
              <span className="metadata-value font-semibold">{tenant.tenant_id}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Status</span>
              <span className="metadata-value">
                <StatusBadge status={tenant.status} size="sm" />
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Environment</span>
              <span className="metadata-value">{tenant.environment || "dev"}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Created At</span>
              <span className="metadata-value text-sm">{formatDate(tenant.created_at)}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Last Updated</span>
              <span className="metadata-value text-sm text-muted">{formatRelativeTime(tenant.updated_at)}</span>
            </div>
          </div>
        </div>

        {/* Card 2: Host & Infrastructure */}
        <div className="dashboard-card">
          <div className="card-title-group mb-3">
            <Server size={18} className="text-purple" />
            <h3>Host & Network</h3>
          </div>
          <div className="metadata-list">
            <div className="metadata-row">
              <span className="metadata-label">Host ID</span>
              <span className="metadata-value font-mono text-xs">{tenant.host_id || "Unassigned"}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Private VPC IP</span>
              <span className="metadata-value font-mono text-sm">{privateIp}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">MySQL Port</span>
              <span className="metadata-value">
                <span className="port-badge">{port} (Non-Default)</span>
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">VPC Isolation</span>
              <span className="metadata-value text-sm text-green">Private Subnet Only</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Security Group</span>
              <span className="metadata-value text-xs text-muted">VPC Ingress Port 3307</span>
            </div>
          </div>
        </div>

        {/* Card 3: Database & Isolation */}
        <div className="dashboard-card">
          <div className="card-title-group mb-3">
            <Database size={18} className="text-teal" />
            <h3>Database & Privileges</h3>
          </div>
          <div className="metadata-list">
            <div className="metadata-row stacked">
              <span className="metadata-label">Database Name</span>
              <span className="metadata-value code-pill font-mono text-xs font-semibold" title={dbName}>
                {dbName}
              </span>
            </div>
            <div className="metadata-row stacked">
              <span className="metadata-label">MySQL Username</span>
              <span className="metadata-value code-pill font-mono text-xs" title={username}>
                {username}
              </span>
            </div>
            <div className="metadata-row stacked">
              <span className="metadata-label">Privilege Scope</span>
              <span className="metadata-value code-pill font-mono text-xs" title={`${dbName}.* (ALL PRIVILEGES)`}>
                {dbName}.* <span className="text-muted font-sans font-normal">(ALL PRIVILEGES)</span>
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Cross-DB Access</span>
              <span className="metadata-value text-xs text-red font-medium">Blocked</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Root Administration</span>
              <span className="metadata-value text-xs text-red font-medium">Restricted</span>
            </div>
          </div>
        </div>
      </div>

      {/* Connection & Secrets Section */}
      <div className="dashboard-card mt-6">
        <div className="card-title-group mb-3">
          <Lock size={18} className="text-amber" />
          <h3>MySQL Connection & Credentials</h3>
        </div>

        {/* Secrets Manager Callout */}
        <div className="security-notice-callout mb-4">
          <ShieldAlert size={20} className="text-amber flex-shrink-0" />
          <div>
            <strong>AWS Secrets Manager Storage:</strong>
            <p className="text-xs text-muted mt-1">
              Plaintext database passwords are never stored in DynamoDB or returned over public APIs. Credentials are managed directly via AWS Secrets Manager.
            </p>
          </div>
        </div>

        {/* Secrets ARN */}
        <div className="connection-spec-item mb-4">
          <span className="spec-label">AWS Secrets Manager Secret ARN:</span>
          <div className="copy-code-box">
            <code className="font-mono text-xs">
              {tenant.credentials_secret_arn ||
                `arn:aws:secretsmanager:ap-south-1:*:secret:multi-tenant-mysql/tenants/dev/${tenant.tenant_id}`}
            </code>
            <button
              className="copy-btn"
              onClick={() =>
                handleCopy(
                  tenant.credentials_secret_arn ||
                    `arn:aws:secretsmanager:ap-south-1:*:secret:multi-tenant-mysql/tenants/dev/${tenant.tenant_id}`,
                  "arn"
                )
              }
              aria-label="Copy Secret ARN"
            >
              {copiedKey === "arn" ? <Check size={14} className="text-green" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Masked Password Row */}
        <div className="connection-spec-item mb-4">
          <span className="spec-label">Tenant Database Password:</span>
          <div className="password-mask-row">
            <div className="masked-box font-mono">
              {revealed ? (
                <span className="revealed-secret">
                  [Stored securely in Secrets Manager - Access via AWS CLI: <code>aws secretsmanager get-secret-value</code>]
                </span>
              ) : (
                "••••••••••••••••••••••••"
              )}
            </div>
            <button
              className="secondary-button btn-sm"
              onClick={() => setRevealed((prev) => !prev)}
            >
              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>{revealed ? "Hide Info" : "Reveal Reference"}</span>
            </button>
          </div>
        </div>

        {/* CLI Connection Helper */}
        <div className="connection-spec-item">
          <span className="spec-label">VPC Bastion / Internal MySQL CLI Command:</span>
          <div className="copy-code-box">
            <code className="font-mono text-xs">{cliConnectionString}</code>
            <button
              className="copy-btn"
              onClick={() => handleCopy(cliConnectionString, "cli")}
              aria-label="Copy connection string"
            >
              {copiedKey === "cli" ? <Check size={14} className="text-green" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Backups List Section */}
      <div className="dashboard-card mt-6">
        <div className="card-header-bar mb-3">
          <div className="card-title-group">
            <DatabaseBackup size={18} className="text-blue" />
            <h3>Tenant Database Backups</h3>
          </div>
          <button
            className="secondary-button btn-sm"
            onClick={handleTriggerBackup}
            disabled={!isReady || backingUp}
          >
            <DatabaseBackup size={14} />
            <span>Create New Backup</span>
          </button>
        </div>

        {backups.length === 0 ? (
          <div className="card-empty-inline">
            <p>No backups recorded in Amazon S3 for this tenant.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="safe-table">
              <thead>
                <tr>
                  <th>Backup ID</th>
                  <th>S3 Location</th>
                  <th>Size</th>
                  <th>Created At</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.backup_id}>
                    <td className="font-mono text-xs font-semibold">{b.backup_id}</td>
                    <td className="font-mono text-xs text-muted">{b.s3_key || `tenants/${tenantId}/${b.backup_id}.sql.gz`}</td>
                    <td className="text-sm">{formatBytes(b.size_bytes)}</td>
                    <td className="text-sm text-muted">{formatDate(b.created_at)}</td>
                    <td>
                      <StatusBadge status={b.status || "COMPLETED"} size="sm" />
                    </td>
                    <td className="text-right">
                      <button
                        className="secondary-button btn-xs"
                        onClick={() =>
                          navigate(
                            `/restore?tenant=${encodeURIComponent(tenantId)}&backup=${encodeURIComponent(b.backup_id)}`
                          )
                        }
                      >
                        <RotateCcw size={13} />
                        <span>Restore</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Jobs for this Tenant */}
      <div className="dashboard-card mt-6">
        <div className="card-title-group mb-3">
          <Key size={18} className="text-purple" />
          <h3>Provisioning History for this Tenant</h3>
        </div>

        {jobs.length === 0 ? (
          <div className="card-empty-inline">
            <p>No recent jobs recorded in DynamoDB for this tenant.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="safe-table">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Updated</th>
                  <th className="text-right">View</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.job_id}>
                    <td className="font-mono text-xs">{j.job_id}</td>
                    <td><span className="stage-tag">{j.stage || "API_REQUEST"}</span></td>
                    <td><StatusBadge status={j.status} size="sm" /></td>
                    <td className="text-sm text-muted">{formatDate(j.created_at)}</td>
                    <td className="text-sm text-muted">{formatRelativeTime(j.updated_at)}</td>
                    <td className="text-right">
                      <Link to={`/jobs/${j.job_id}`} className="secondary-button btn-xs">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Deprovision */}
      <ConfirmModal
        isOpen={showTerminateModal}
        title="Deprovision Tenant Database?"
        message={`Are you sure you want to permanently delete tenant "${tenant.tenant_id}"? This drops MySQL database "${dbName}", removes MySQL user permissions, deletes the secret from AWS Secrets Manager, and frees up a slot on host "${tenant.host_id}".`}
        confirmLabel="Deprovision Tenant"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={terminating}
        onConfirm={handleConfirmTerminate}
        onClose={() => setShowTerminateModal(false)}
      />
    </div>
  );
}
