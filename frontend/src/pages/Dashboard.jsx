import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  CheckCircle2,
  Clock3,
  AlertCircle,
  Server,
  Layers,
  Activity,
  PlusCircle,
  RefreshCw,
  ExternalLink,
  Database,
  Terminal,
} from "lucide-react";
import {
  getTenants,
  getJobs,
  getHosts,
  getSystemHealth,
} from "../services/api";
import StatusBadge from "../components/StatusBadge";
import { SkeletonCard, SkeletonTable } from "../components/Skeleton";
import { formatDate, formatRelativeTime } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function Dashboard() {
  const [tenants, setTenants] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const loadDashboardData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const [tenantsRes, jobsRes, hostsRes, healthRes] = await Promise.allSettled([
        getTenants(),
        getJobs(),
        getHosts(),
        getSystemHealth(),
      ]);

      if (tenantsRes.status === "fulfilled") {
        const val = tenantsRes.value;
        setTenants(Array.isArray(val) ? val : val?.tenants || []);
      }
      if (jobsRes.status === "fulfilled") {
        const val = jobsRes.value;
        setJobs(Array.isArray(val) ? val : val?.jobs || []);
      }
      if (hostsRes.status === "fulfilled") {
        const val = hostsRes.value;
        setHosts(Array.isArray(val) ? val : val?.hosts || []);
      }
      if (healthRes.status === "fulfilled") {
        setHealth(healthRes.value || null);
      }
    } catch {
      toast.error("Unable to load latest dashboard metrics.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Derived metrics from live data
  const totalTenants = tenants.length;
  const readyTenants = tenants.filter((t) => t.status === "READY").length;
  const provisioningTenants = tenants.filter(
    (t) => t.status === "PENDING" || t.status === "BOOTSTRAPPING"
  ).length;
  const failedTenants = tenants.filter((t) => t.status === "FAILED").length;

  const totalHosts = hosts.length;
  const activeHosts = hosts.filter((h) => h.status === "READY").length;
  const totalAvailableCapacity = hosts.reduce(
    (acc, h) => acc + (h.available_capacity ?? Math.max(0, (h.capacity || 5) - (h.tenant_count || 0))),
    0
  );

  const recentTenants = tenants.slice(0, 5);
  const recentJobs = jobs.slice(0, 5);

  return (
    <div className="dashboard-page page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Infrastructure Overview</h1>
          <p className="page-subtitle">
            Live telemetry for multi-tenant MySQL databases on AWS.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => loadDashboardData(true)}
            disabled={refreshing}
            title="Refresh metrics from AWS"
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
          <Link to="/provision" className="primary-button">
            <PlusCircle size={16} />
            <span>Provision Tenant</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="kpi-grid">
        {loading ? (
          <SkeletonCard count={6} />
        ) : (
          <>
            <div className="dashboard-card kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Total Tenants</span>
                <div className="kpi-icon-box bg-blue">
                  <Users size={20} />
                </div>
              </div>
              <div className="kpi-value">{totalTenants}</div>
              <div className="kpi-meta">Across all provisioned hosts</div>
            </div>

            <div className="dashboard-card kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Ready Tenants</span>
                <div className="kpi-icon-box bg-green">
                  <CheckCircle2 size={20} />
                </div>
              </div>
              <div className="kpi-value text-green">{readyTenants}</div>
              <div className="kpi-meta">Isolated & accepting traffic</div>
            </div>

            <div className="dashboard-card kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Provisioning</span>
                <div className="kpi-icon-box bg-amber">
                  <Clock3 size={20} />
                </div>
              </div>
              <div className="kpi-value text-amber">{provisioningTenants}</div>
              <div className="kpi-meta">Pending / Bootstrapping</div>
            </div>

            <div className="dashboard-card kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Failed Tenants</span>
                <div className="kpi-icon-box bg-red">
                  <AlertCircle size={20} />
                </div>
              </div>
              <div className="kpi-value text-red">{failedTenants}</div>
              <div className="kpi-meta">Requires inspection or retry</div>
            </div>

            <div className="dashboard-card kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Active EC2 Hosts</span>
                <div className="kpi-icon-box bg-purple">
                  <Server size={20} />
                </div>
              </div>
              <div className="kpi-value">
                {activeHosts} <span className="kpi-unit">/ {totalHosts}</span>
              </div>
              <div className="kpi-meta">Dedicated MySQL port 3307</div>
            </div>

            <div className="dashboard-card kpi-card">
              <div className="kpi-header">
                <span className="kpi-title">Available Capacity</span>
                <div className="kpi-icon-box bg-teal">
                  <Layers size={20} />
                </div>
              </div>
              <div className="kpi-value text-teal">
                {totalAvailableCapacity}{" "}
                <span className="kpi-unit">slots</span>
              </div>
              <div className="kpi-meta">Before new EC2 launch needed</div>
            </div>
          </>
        )}
      </div>

      {/* Main Grid: Activity & Health */}
      <div className="dashboard-split-grid">
        {/* Recent Tenants Section */}
        <div className="dashboard-card split-col-left">
          <div className="card-header-bar">
            <div className="card-title-group">
              <Database size={18} className="text-blue" />
              <h3>Recent Tenant Activity</h3>
            </div>
            <Link to="/tenants" className="card-link">
              <span>View All Tenants</span>
              <ExternalLink size={14} />
            </Link>
          </div>

          <div className="card-body">
            {loading ? (
              <SkeletonTable rows={4} cols={5} />
            ) : recentTenants.length === 0 ? (
              <div className="card-empty-inline">
                <p>No tenants provisioned yet.</p>
                <Link to="/provision" className="text-btn">
                  Provision your first tenant &rarr;
                </Link>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="safe-table mini-table">
                  <thead>
                    <tr>
                      <th>Tenant ID</th>
                      <th>Host</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentTenants.map((t) => (
                      <tr key={t.tenant_id}>
                        <td className="font-semibold text-primary">
                          <Link
                            to={`/tenants/${encodeURIComponent(t.tenant_id)}`}
                            className="table-link"
                          >
                            {t.tenant_id}
                          </Link>
                        </td>
                        <td className="font-mono text-sm">
                          {t.host_id || "Unassigned"}
                        </td>
                        <td>
                          <StatusBadge status={t.status} size="sm" />
                        </td>
                        <td className="text-sm text-muted">
                          {formatRelativeTime(t.created_at)}
                        </td>
                        <td className="text-right table-action-cell">
                          <button
                            className="action-icon-btn"
                            title="Query Database"
                            onClick={() =>
                              navigate(
                                `/tenants/${encodeURIComponent(t.tenant_id)}/query`
                              )
                            }
                          >
                            <Terminal size={15} />
                          </button>
                          <button
                            className="action-icon-btn"
                            title="View Details"
                            onClick={() =>
                              navigate(
                                `/tenants/${encodeURIComponent(t.tenant_id)}`
                              )
                            }
                          >
                            <ExternalLink size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* System Health Widget */}
        <div className="dashboard-card split-col-right">
          <div className="card-header-bar">
            <div className="card-title-group">
              <Activity size={18} className="text-green" />
              <h3>System Health</h3>
            </div>
            <Link to="/health" className="card-link">
              <span>Full Health</span>
              <ExternalLink size={14} />
            </Link>
          </div>

          <div className="card-body">
            {loading ? (
              <SkeletonTable rows={5} cols={2} />
            ) : !health ? (
              <div className="card-empty-inline">
                <p>Health telemetry unavailable. Check API Gateway status.</p>
              </div>
            ) : (
              <div className="health-widget-list">
                <div className="health-overall-banner">
                  <span className="health-overall-label">Overall Status:</span>
                  <StatusBadge status={health.status || "UNKNOWN"} size="sm" />
                  <span className="health-timestamp">
                    {formatRelativeTime(health.timestamp)}
                  </span>
                </div>

                <div className="health-rows">
                  {Object.entries(health.services || {}).map(([key, svc]) => (
                    <div key={key} className="health-row-item">
                      <span className="service-name">{svc.name || key}</span>
                      <div className="service-status-group">
                        {svc.latency_ms !== undefined && (
                          <span className="service-latency">
                            {svc.latency_ms}ms
                          </span>
                        )}
                        <StatusBadge status={svc.status} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Jobs Section */}
      <div className="dashboard-card mt-6">
        <div className="card-header-bar">
          <div className="card-title-group">
            <Clock3 size={18} className="text-purple" />
            <h3>Recent Provisioning Jobs</h3>
          </div>
          <Link to="/jobs" className="card-link">
            <span>View All Jobs</span>
            <ExternalLink size={14} />
          </Link>
        </div>

        <div className="card-body">
          {loading ? (
            <SkeletonTable rows={4} cols={6} />
          ) : recentJobs.length === 0 ? (
            <div className="card-empty-inline">
              <p>No recent jobs recorded in DynamoDB.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="safe-table">
                <thead>
                  <tr>
                    <th>Job ID</th>
                    <th>Tenant ID</th>
                    <th>Stage</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Updated</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((j) => (
                    <tr key={j.job_id}>
                      <td className="font-mono text-sm font-semibold">
                        <Link to={`/jobs/${j.job_id}`} className="table-link">
                          {j.job_id.substring(0, 13)}...
                        </Link>
                      </td>
                      <td className="font-semibold text-primary">
                        {j.tenant_id}
                      </td>
                      <td>
                        <span className="stage-tag">{j.stage || "API_REQUEST"}</span>
                      </td>
                      <td>
                        <StatusBadge status={j.status} size="sm" />
                      </td>
                      <td className="text-sm text-muted">
                        {formatDate(j.created_at)}
                      </td>
                      <td className="text-sm text-muted">
                        {formatRelativeTime(j.updated_at)}
                      </td>
                      <td className="text-right">
                        <Link
                          to={`/jobs/${j.job_id}`}
                          className="secondary-button btn-xs"
                        >
                          View Job
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
