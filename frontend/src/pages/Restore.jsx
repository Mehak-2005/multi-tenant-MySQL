import { useState, useEffect } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import {
  RotateCcw,
  AlertTriangle,
  DatabaseBackup,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import {
  getTenants,
  getTenantBackups,
  restoreTenant,
} from "../services/api";
import ConfirmModal from "../components/ConfirmModal";
import StatusBadge from "../components/StatusBadge";
import { formatDate, formatBytes } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function Restore() {
  const [searchParams] = useSearchParams();
  const urlTenant = searchParams.get("tenant") || "";
  const urlBackup = searchParams.get("backup") || "";

  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(urlTenant);
  const [backups, setBackups] = useState([]);
  const [selectedBackupId, setSelectedBackupId] = useState(urlBackup);
  const [loadingBackups, setLoadingBackups] = useState(false);

  // Confirmation Modal & Restore State
  const [showConfirm, setShowConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);

  const toast = useToast();
  const navigate = useNavigate();

  // Load tenants on mount
  useEffect(() => {
    let isMounted = true;
    async function loadTenantsList() {
      try {
        const data = await getTenants();
        const list = data?.tenants || [];
        if (!isMounted) return;
        setTenants(list);
        if (!urlTenant && list.length > 0) {
          const firstReady = list.find((t) => t.status === "READY");
          setSelectedTenant(firstReady ? firstReady.tenant_id : list[0].tenant_id);
        }
      } catch (err) {
        console.error("loadTenantsList error:", err);
        if (isMounted) toast.error("Could not load tenants.");
      }
    }
    loadTenantsList();
    return () => {
      isMounted = false;
    };
  }, []); // Run only on mount

  // Load backups when selected tenant changes
  useEffect(() => {
    if (!selectedTenant) {
      setBackups([]);
      setSelectedBackupId("");
      return;
    }

    let isMounted = true;
    async function fetchBackups() {
      setLoadingBackups(true);
      try {
        const data = await getTenantBackups(selectedTenant);
        const list = data?.backups || [];
        if (!isMounted) return;
        setBackups(list);
        if (list.length > 0) {
          setSelectedBackupId((prev) => (list.some((b) => b.backup_id === prev) ? prev : list[0].backup_id));
        } else {
          setSelectedBackupId("");
        }
      } catch {
        if (isMounted) toast.error("Could not fetch backups for tenant.");
      } finally {
        if (isMounted) setLoadingBackups(false);
      }
    }
    fetchBackups();

    return () => {
      isMounted = false;
    };
  }, [selectedTenant]);

  const handleStartRestoreClick = (e) => {
    e.preventDefault();
    if (!selectedTenant) {
      toast.error("Please select a target tenant.");
      return;
    }
    if (!selectedBackupId) {
      toast.error("Please select a backup archive to restore from.");
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmRestore = async () => {
    setRestoring(true);
    try {
      const res = await restoreTenant(selectedTenant, selectedBackupId);
      setRestoreResult(res);
      toast.success(
        `Restore dispatched to AWS Systems Manager (Command: ${res.command_id?.substring(0, 8)}...).`
      );
      setShowConfirm(false);
    } catch (err) {
      toast.error(err.message || "Failed to start database restore.");
    } finally {
      setRestoring(false);
    }
  };

  const selectedBackupObj = backups.find((b) => b.backup_id === selectedBackupId);

  return (
    <div className="restore-page page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Restore Database</h1>
          <p className="page-subtitle">
            Restore a tenant MySQL database from an encrypted Amazon S3 snapshot.
          </p>
        </div>
      </div>

      {/* Warning Callout */}
      <div className="security-notice-callout warning-callout mb-6">
        <AlertTriangle size={22} className="text-amber flex-shrink-0" />
        <div>
          <strong>Destructive Operation Warning:</strong>
          <p className="text-xs text-muted mt-1">
            Restoring from a backup will overwrite tables and data currently inside the tenant&apos;s isolated database. Ensure you have a recent snapshot or backup before proceeding.
          </p>
        </div>
      </div>

      {/* Form Card */}
      <div className="dashboard-card mb-6">
        <form onSubmit={handleStartRestoreClick} className="restore-form">
          {/* Step 1: Select Tenant */}
          <div className="form-field mb-4">
            <label htmlFor="restoreTenantSelect" className="form-label">
              1. Target Tenant Database <span className="text-red">*</span>
            </label>
            <select
              id="restoreTenantSelect"
              className="form-input"
              value={selectedTenant}
              onChange={(e) => {
                setSelectedTenant(e.target.value);
                setSelectedBackupId("");
                setRestoreResult(null);
              }}
              disabled={restoring}
            >
              <option value="" disabled>
                Select target tenant...
              </option>
              {tenants.map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.tenant_id} ({t.status}) — {t.database_name || "db"}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2: Select Backup */}
          <div className="form-field mb-6">
            <label htmlFor="restoreBackupSelect" className="form-label">
              2. Available S3 Backup Archive <span className="text-red">*</span>
            </label>
            {loadingBackups ? (
              <div className="text-sm text-muted p-2">Loading backups for tenant...</div>
            ) : backups.length === 0 ? (
              <div className="empty-backups-note">
                <p className="text-sm text-muted">
                  No backup archives found in S3 for tenant &quot;{selectedTenant}&quot;.
                </p>
                <Link
                  to={`/backups?tenant=${encodeURIComponent(selectedTenant)}`}
                  className="secondary-button btn-xs mt-2 inline-flex"
                >
                  <DatabaseBackup size={14} />
                  <span>Create a Backup First</span>
                </Link>
              </div>
            ) : (
              <select
                id="restoreBackupSelect"
                className="form-input"
                value={selectedBackupId}
                onChange={(e) => setSelectedBackupId(e.target.value)}
                disabled={restoring}
              >
                {backups.map((b) => (
                  <option key={b.backup_id} value={b.backup_id}>
                    {b.backup_id} — {formatDate(b.created_at)} ({formatBytes(b.size_bytes)})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Selected Backup Summary Card */}
          {selectedBackupObj && (
            <div className="selected-backup-summary mb-6">
              <h4 className="text-sm font-semibold mb-2">Selected Archive Details</h4>
              <div className="metadata-list text-xs">
                <div className="metadata-row">
                  <span className="metadata-label">Archive ID:</span>
                  <span className="metadata-value font-mono">{selectedBackupObj.backup_id}</span>
                </div>
                <div className="metadata-row">
                  <span className="metadata-label">S3 Target:</span>
                  <span className="metadata-value font-mono truncate">
                    s3://{selectedBackupObj.s3_bucket}/{selectedBackupObj.s3_key}
                  </span>
                </div>
                <div className="metadata-row">
                  <span className="metadata-label">Snapshot Date:</span>
                  <span className="metadata-value">{formatDate(selectedBackupObj.created_at)}</span>
                </div>
                <div className="metadata-row">
                  <span className="metadata-label">Archive Size:</span>
                  <span className="metadata-value">{formatBytes(selectedBackupObj.size_bytes)}</span>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="danger-button submit-btn"
            disabled={restoring || !selectedTenant || !selectedBackupId}
          >
            <RotateCcw size={16} />
            <span>Initiate Restore...</span>
          </button>
        </form>
      </div>

      {/* Restore Result Card */}
      {restoreResult && (
        <div className="dashboard-card restore-result-card">
          <div className="flex items-center gap-3 mb-3">
            <CheckCircle2 size={22} className="text-green" />
            <div>
              <h3 className="card-section-title">Restore Command Dispatched</h3>
              <p className="text-sm text-muted">
                AWS Systems Manager command is executing mysqldump import on the EC2 host.
              </p>
            </div>
          </div>

          <div className="metadata-list text-xs">
            <div className="metadata-row">
              <span className="metadata-label">SSM Command ID</span>
              <span className="metadata-value font-mono">{restoreResult.command_id}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Tenant ID</span>
              <span className="metadata-value font-semibold">{restoreResult.tenant_id}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Target Database</span>
              <span className="metadata-value font-mono">{restoreResult.database_name}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Status</span>
              <span className="metadata-value">
                <StatusBadge status={restoreResult.status || "IN_PROGRESS"} size="sm" />
              </span>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              className="primary-button btn-sm"
              onClick={() =>
                navigate(`/tenants/${encodeURIComponent(selectedTenant)}/query`)
              }
            >
              <span>Test with Query Console</span>
              <ArrowRight size={14} />
            </button>
            <button
              className="secondary-button btn-sm"
              onClick={() =>
                navigate(`/tenants/${encodeURIComponent(selectedTenant)}`)
              }
            >
              View Tenant
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmModal
        isOpen={showConfirm}
        title="Confirm Database Overwrite"
        message={`You are about to restore tenant "${selectedTenant}" from backup "${selectedBackupId}". This may overwrite current tenant data with the snapshot. This operation cannot be reversed.`}
        confirmLabel="Overwrite & Restore"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={restoring}
        onConfirm={handleConfirmRestore}
        onClose={() => setShowConfirm(false)}
      />
    </div>
  );
}
