import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  DatabaseBackup,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
  HardDrive,
} from "lucide-react";
import {
  getTenants,
  getTenantBackups,
  backupTenant,
} from "../services/api";
import StatusBadge from "../components/StatusBadge";
import SafeTable from "../components/SafeTable";
import { formatDate, formatRelativeTime, formatBytes } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function Backups() {
  const [searchParams] = useSearchParams();
  const initialTenant = searchParams.get("tenant") || "";

  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(initialTenant);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [activeBackupJob, setActiveBackupJob] = useState(null);

  const toast = useToast();
  const navigate = useNavigate();

  // Load tenants on mount
  useEffect(() => {
    let isMounted = true;
    async function fetchTenants() {
      try {
        const data = await getTenants();
        const list = data?.tenants || [];
        if (!isMounted) return;
        setTenants(list);
        if (!initialTenant && list.length > 0) {
          const firstReady = list.find((t) => t.status === "READY");
          setSelectedTenant(firstReady ? firstReady.tenant_id : list[0].tenant_id);
        }
      } catch {
        if (isMounted) toast.error("Could not fetch tenant list.");
      }
    }
    fetchTenants();
    return () => {
      isMounted = false;
    };
  }, []); // Run only on mount

  // Load backups for selected tenant
  const loadBackups = useCallback(async (isSilent = false) => {
    if (!selectedTenant) {
      setBackups([]);
      setLoading(false);
      return;
    }
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await getTenantBackups(selectedTenant);
      setBackups(data?.backups || []);
    } catch {
      toast.error("Failed to load backups for this tenant.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedTenant]);

  useEffect(() => {
    if (selectedTenant) {
      loadBackups();
    }
  }, [selectedTenant, loadBackups]);

  // Start backup action
  const handleStartBackup = async () => {
    if (!selectedTenant) return;
    setBackingUp(true);
    setActiveBackupJob(null);

    try {
      const res = await backupTenant(selectedTenant);
      setActiveBackupJob(res);
      toast.success(
        `Backup triggered (ID: ${res.backup_id?.substring(0, 8)}...). Executing via AWS SSM.`
      );
      // Wait a moment then refresh list
      setTimeout(() => {
        loadBackups(true);
      }, 3000);
    } catch (err) {
      toast.error(err.message || "Failed to start backup.");
    } finally {
      setBackingUp(false);
    }
  };

  const columns = [
    {
      key: "backup_id",
      label: "Backup ID",
      sortable: true,
      render: (val) => <span className="font-mono text-xs font-semibold">{val}</span>,
    },
    {
      key: "tenant_id",
      label: "Tenant",
      sortable: true,
      render: (val) => (
        <span className="font-semibold text-primary">{val || selectedTenant}</span>
      ),
    },
    {
      key: "s3_key",
      label: "Amazon S3 Key",
      sortable: true,
      render: (val, row) => (
        <span className="font-mono text-xs text-muted" title={val}>
          s3://{row.s3_bucket || "backups"}/{val || `tenants/${selectedTenant}/${row.backup_id}.sql.gz`}
        </span>
      ),
    },
    {
      key: "size_bytes",
      label: "Archive Size",
      sortable: true,
      render: (val) => <span className="text-sm">{formatBytes(val)}</span>,
    },
    {
      key: "created_at",
      label: "Created At",
      sortable: true,
      render: (val) => (
        <div>
          <div className="text-sm">{formatDate(val)}</div>
          <div className="text-xs text-muted">{formatRelativeTime(val)}</div>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val || "COMPLETED"} size="sm" />,
    },
    {
      key: "actions",
      label: "Action",
      sortable: false,
      render: (_, row) => (
        <button
          className="secondary-button btn-xs"
          onClick={() =>
            navigate(
              `/restore?tenant=${encodeURIComponent(
                row.tenant_id || selectedTenant
              )}&backup=${encodeURIComponent(row.backup_id)}`
            )
          }
        >
          <RotateCcw size={13} />
          <span>Restore</span>
        </button>
      ),
    },
  ];

  return (
    <div className="backups-page page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Database Backups</h1>
          <p className="page-subtitle">
            Create on-demand mysqldump snapshots stored securely in Amazon S3 via AWS SSM.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => loadBackups(true)}
            disabled={refreshing || !selectedTenant}
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Security Callout */}
      <div className="security-notice-callout mb-6">
        <ShieldCheck size={22} className="text-blue flex-shrink-0" />
        <div>
          <strong>Serverless Remote Execution:</strong>
          <p className="text-xs text-muted mt-1">
            Backups are triggered through AWS Systems Manager (SSM) directly on the EC2 host. The host retrieves its administration secret via IAM without exposing passwords over the network. Dumps are compressed (<code>.sql.gz</code>) and uploaded directly to S3.
          </p>
        </div>
      </div>

      {/* Control Toolbar Card */}
      <div className="dashboard-card mb-6">
        <div className="query-toolbar">
          <div className="tenant-selector-group">
            <label htmlFor="backupTenantSelect" className="selector-label">
              <HardDrive size={16} className="text-blue" />
              <span>Select Tenant:</span>
            </label>
            <select
              id="backupTenantSelect"
              className="tenant-select-dropdown"
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              disabled={backingUp}
            >
              <option value="" disabled>
                Select a tenant...
              </option>
              {tenants.map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.tenant_id} ({t.status}) — {t.database_name || "db"}
                </option>
              ))}
            </select>
          </div>

          <div className="query-actions-right">
            <button
              className="primary-button"
              onClick={handleStartBackup}
              disabled={backingUp || !selectedTenant}
            >
              <DatabaseBackup size={16} />
              <span>{backingUp ? "Starting SSM Backup..." : "Start Backup"}</span>
            </button>
          </div>
        </div>

        {/* In-Progress Notification Banner */}
        {activeBackupJob && (
          <div className="backup-active-card mt-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} className="text-green flex-shrink-0" />
              <div>
                <strong>Backup Dispatched to AWS Systems Manager:</strong>
                <p className="text-xs text-muted mt-1">
                  Backup ID: <code className="font-mono">{activeBackupJob.backup_id}</code> | Command ID: <code className="font-mono">{activeBackupJob.command_id}</code> | Target: <code>s3://{activeBackupJob.s3_bucket}/{activeBackupJob.s3_key}</code>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Backups Table */}
      <div className="dashboard-card">
        <div className="card-header-bar mb-3">
          <div className="card-title-group">
            <DatabaseBackup size={18} className="text-blue" />
            <h3>Previous Backups for {selectedTenant || "Selected Tenant"}</h3>
          </div>
        </div>

        <SafeTable
          columns={columns}
          data={backups}
          isLoading={loading}
          emptyTitle="No Backups Found"
          emptyDesc={
            selectedTenant
              ? `No previous S3 backups recorded for tenant "${selectedTenant}".`
              : "Select a tenant to view backup archives."
          }
          searchPlaceholder="Search backup ID..."
          searchKey="backup_id"
          pageSize={10}
        />
      </div>
    </div>
  );
}
