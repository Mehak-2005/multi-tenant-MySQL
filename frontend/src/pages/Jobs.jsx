import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  RefreshCw,
  Search,
  Filter,
  ArrowRight,
} from "lucide-react";
import { getJobs } from "../services/api";
import StatusBadge from "../components/StatusBadge";
import SafeTable from "../components/SafeTable";
import { formatDate, formatDuration, formatRelativeTime } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const toast = useToast();
  const navigate = useNavigate();

  const loadJobs = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await getJobs();
      setJobs(Array.isArray(data) ? data : data?.jobs || []);
    } catch (err) {
      toast.error(err.message || "Failed to retrieve jobs from DynamoDB.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (statusFilter !== "ALL" && j.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchJobId = (j.job_id || "").toLowerCase().includes(query);
        const matchTenant = (j.tenant_id || "").toLowerCase().includes(query);
        const matchStage = (j.stage || "").toLowerCase().includes(query);
        return matchJobId || matchTenant || matchStage;
      }
      return true;
    });
  }, [jobs, statusFilter, searchQuery]);

  const columns = [
    {
      key: "job_id",
      label: "Job ID",
      sortable: true,
      render: (val) => (
        <Link to={`/jobs/${val}`} className="table-link font-mono font-semibold">
          {val}
        </Link>
      ),
    },
    {
      key: "tenant_id",
      label: "Tenant ID",
      sortable: true,
      render: (val) => (
        <span className="font-semibold text-primary">{val}</span>
      ),
    },
    {
      key: "stage",
      label: "Stage",
      sortable: true,
      render: (val) => (
        <span className="stage-tag">{val || "API_REQUEST"}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (val) => <StatusBadge status={val} size="sm" />,
    },
    {
      key: "created_at",
      label: "Started At",
      sortable: true,
      render: (val) => (
        <div>
          <div className="text-sm">{formatDate(val)}</div>
          <div className="text-xs text-muted">{formatRelativeTime(val)}</div>
        </div>
      ),
    },
    {
      key: "updated_at",
      label: "Duration",
      sortable: false,
      render: (_, row) => (
        <div className="text-sm text-muted">
          {formatDuration(row.created_at, row.updated_at)}
        </div>
      ),
    },
    {
      key: "error",
      label: "Error / Notes",
      sortable: false,
      render: (val) => (
        val ? (
          <span className="text-xs text-red line-clamp-1" title={val}>
            {val}
          </span>
        ) : (
          <span className="text-xs text-muted">Normal Execution</span>
        )
      ),
    },
    {
      key: "actions",
      label: "Action",
      sortable: false,
      render: (_, row) => (
        <button
          className="action-icon-btn"
          title="View Job Details"
          onClick={() => navigate(`/jobs/${row.job_id}`)}
        >
          <ArrowRight size={16} />
        </button>
      ),
    },
  ];

  return (
    <div className="jobs-page page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Provisioning Jobs</h1>
          <p className="page-subtitle">
            Track asynchronous workflow executions, Step Functions states, and duration metrics.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => loadJobs(true)}
            disabled={refreshing}
            title="Refresh jobs from DynamoDB"
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="dashboard-card filters-card mb-4">
        <div className="filters-bar">
          <div className="search-box-group">
            <Search size={16} className="search-box-icon" />
            <input
              type="text"
              className="search-box-input"
              placeholder="Search by Job ID, Tenant ID, or stage..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="dropdown-filters-group">
            <div className="filter-select-wrapper">
              <Filter size={15} className="filter-select-icon" />
              <select
                className="filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by Status"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="BOOTSTRAPPING">Bootstrapping</option>
                <option value="READY">Ready</option>
                <option value="FAILED">Failed</option>
                <option value="TERMINATED">Terminated</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="dashboard-card">
        <SafeTable
          columns={columns}
          data={filteredJobs}
          isLoading={loading}
          emptyTitle="No Provisioning Jobs"
          emptyDesc={
            searchQuery || statusFilter !== "ALL"
              ? "No jobs matched the selected filters."
              : "No provisioning jobs have been created yet."
          }
          searchPlaceholder={null}
          pageSize={10}
        />
      </div>
    </div>
  );
}
