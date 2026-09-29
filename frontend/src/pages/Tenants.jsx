import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  PlusCircle,
  RefreshCw,
  Search,
  Filter,
  Eye,
  Terminal,
  DatabaseBackup,
  RotateCcw,
  Trash2,
  Database,
} from "lucide-react";
import { getTenants, deleteTenant } from "../services/api";
import StatusBadge from "../components/StatusBadge";
import SafeTable from "../components/SafeTable";
import ConfirmModal from "../components/ConfirmModal";
import { formatDate } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [hostFilter, setHostFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Terminate Modal State
  const [terminateTarget, setTerminateTarget] = useState(null);
  const [terminating, setTerminating] = useState(false);

  const toast = useToast();
  const navigate = useNavigate();

  const loadTenants = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await getTenants();
      setTenants(Array.isArray(data) ? data : data?.tenants || []);
    } catch (err) {
      toast.error(err.message || "Failed to retrieve tenants from AWS.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  // Unique list of hosts for filter
  const uniqueHosts = useMemo(() => {
    const set = new Set();
    tenants.forEach((t) => {
      if (t.host_id) set.add(t.host_id);
    });
    return Array.from(set);
  }, [tenants]);

  // Filtered dataset
  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) {
        return false;
      }
      if (hostFilter !== "ALL" && t.host_id !== hostFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchId = (t.tenant_id || "").toLowerCase().includes(query);
        const matchDb = (t.database_name || "").toLowerCase().includes(query);
        const matchHost = (t.host_id || "").toLowerCase().includes(query);
        return matchId || matchDb || matchHost;
      }
      return true;
    });
  }, [tenants, statusFilter, hostFilter, searchQuery]);

  // Handle Terminate action
  const handleConfirmTerminate = async () => {
    if (!terminateTarget) return;
    setTerminating(true);
    try {
      await deleteTenant(terminateTarget.tenant_id);
      toast.success(
        `Tenant "${terminateTarget.tenant_id}" deprovisioned successfully.`
      );
      setTerminateTarget(null);
      await loadTenants(true);
    } catch (err) {
      toast.error(err.message || "Failed to deprovision tenant.");
    } finally {
      setTerminating(false);
    }
  };

  const columns = [
    {
      key: "tenant_id",
      label: "Tenant ID",
      sortable: true,
      render: (val) => (
        <Link to={`/tenants/${encodeURIComponent(val)}`} className="table-link font-semibold">
          {val}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val} size="sm" />,
    },
    {
      key: "host_id",
      label: "Host ID",
      sortable: true,
      render: (val, row) => (
        <div>
          <div className="font-mono text-xs">{val || "Unassigned"}</div>
          {row.private_ip && (
            <div className="text-xs text-muted">{row.private_ip}</div>
          )}
        </div>
      ),
    },
    {
      key: "database_name",
      label: "Database",
      sortable: true,
      render: (val) => <span className="font-mono text-xs">{val || "—"}</span>,
    },
    {
      key: "mysql_port",
      label: "Port",
      sortable: true,
      render: (val) => <span className="port-badge">{val || 3307}</span>,
    },
    {
      key: "created_at",
      label: "Created At",
      sortable: true,
      render: (val) => <span className="text-sm text-muted">{formatDate(val)}</span>,
    },
    {
      key: "updated_at",
      label: "Updated At",
      sortable: true,
      render: (val) => <span className="text-sm text-muted">{formatDate(val)}</span>,
    },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      render: (_, row) => {
        const isReady = row.status === "READY";
        return (
          <div className="table-actions-row">
            <button
              className="action-icon-btn"
              title="View Details"
              onClick={() => navigate(`/tenants/${encodeURIComponent(row.tenant_id)}`)}
            >
              <Eye size={15} />
            </button>
            <button
              className="action-icon-btn"
              title={isReady ? "Query Database" : "Query only available when READY"}
              disabled={!isReady}
              onClick={() =>
                navigate(`/tenants/${encodeURIComponent(row.tenant_id)}/query`)
              }
            >
              <Terminal size={15} />
            </button>
            <button
              className="action-icon-btn"
              title={isReady ? "Create Backup" : "Backup only available when READY"}
              disabled={!isReady}
              onClick={() =>
                navigate(`/backups?tenant=${encodeURIComponent(row.tenant_id)}`)
              }
            >
              <DatabaseBackup size={15} />
            </button>
            <button
              className="action-icon-btn"
              title="Restore"
              onClick={() =>
                navigate(`/restore?tenant=${encodeURIComponent(row.tenant_id)}`)
              }
            >
              <RotateCcw size={15} />
            </button>
            <button
              className="action-icon-btn btn-danger"
              title={
                row.status === "TERMINATED"
                  ? "Tenant is already terminated"
                  : "Deprovision / Terminate Tenant"
              }
              disabled={row.status === "TERMINATED"}
              onClick={() => setTerminateTarget(row)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="tenants-page page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Tenant Management</h1>
          <p className="page-subtitle">
            Manage provisioned tenant databases, view isolation status, and inspect credentials.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => loadTenants(true)}
            disabled={refreshing}
            title="Refresh tenants from AWS"
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
          <Link to="/provision" className="primary-button">
            <PlusCircle size={16} />
            <span>Provision New Tenant</span>
          </Link>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="dashboard-card filters-card mb-4">
        <div className="filters-bar">
          {/* Search Box */}
          <div className="search-box-group">
            <Search size={16} className="search-box-icon" />
            <input
              type="text"
              className="search-box-input"
              placeholder="Search by Tenant ID, database, or host..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="dropdown-filters-group">
            {/* Status Filter */}
            <div className="filter-select-wrapper">
              <Filter size={15} className="filter-select-icon" />
              <select
                className="filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by Status"
              >
                <option value="ALL">All Statuses</option>
                <option value="READY">Ready</option>
                <option value="BOOTSTRAPPING">Bootstrapping</option>
                <option value="PENDING">Pending</option>
                <option value="FAILED">Failed</option>
                <option value="TERMINATED">Terminated</option>
              </select>
            </div>

            {/* Host Filter */}
            <div className="filter-select-wrapper">
              <Database size={15} className="filter-select-icon" />
              <select
                className="filter-select"
                value={hostFilter}
                onChange={(e) => setHostFilter(e.target.value)}
                aria-label="Filter by Host"
              >
                <option value="ALL">All Hosts</option>
                {uniqueHosts.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="dashboard-card">
        <SafeTable
          columns={columns}
          data={filteredTenants}
          isLoading={loading}
          emptyTitle="No Tenants Found"
          emptyDesc={
            searchQuery || statusFilter !== "ALL" || hostFilter !== "ALL"
              ? "No tenants matched the selected filters."
              : "No tenants have been provisioned in this environment yet."
          }
          searchPlaceholder={null} // Controlled by our custom filter bar
          pageSize={10}
        />
      </div>

      {/* Terminate Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(terminateTarget)}
        title="Deprovision Tenant Database?"
        message={`Are you sure you want to deprovision tenant "${terminateTarget?.tenant_id}"? This will drop database "${terminateTarget?.database_name || "tenant_db"}", remove MySQL permissions, delete the Secrets Manager credential, and release host capacity.`}
        confirmLabel="Deprovision & Terminate"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={terminating}
        onConfirm={handleConfirmTerminate}
        onClose={() => setTerminateTarget(null)}
      />
    </div>
  );
}
