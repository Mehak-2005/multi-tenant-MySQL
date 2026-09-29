import { useState, useEffect, useCallback } from "react";
import {
  Server,
  RefreshCw,
  Layers,
  Database,
  Activity,
} from "lucide-react";
import { getHosts } from "../services/api";
import StatusBadge from "../components/StatusBadge";
import SafeTable from "../components/SafeTable";
import { formatDate } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function Hosts() {
  const [hosts, setHosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();

  const loadHosts = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await getHosts();
      setHosts(Array.isArray(data) ? data : data?.hosts || []);
    } catch (err) {
      toast.error(err.message || "Failed to retrieve hosts from AWS.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  // Aggregate stats
  const totalHosts = hosts.length;
  const readyHosts = hosts.filter((h) => h.status === "READY").length;
  const totalSlots = hosts.reduce((acc, h) => acc + (h.capacity || 5), 0);
  const occupiedSlots = hosts.reduce((acc, h) => acc + (h.tenant_count || 0), 0);
  const availableSlots = Math.max(0, totalSlots - occupiedSlots);

  const columns = [
    {
      key: "host_id",
      label: "Host ID",
      sortable: true,
      render: (val) => <span className="font-mono font-semibold text-xs">{val}</span>,
    },
    {
      key: "status",
      label: "Host Status",
      sortable: true,
      render: (val) => <StatusBadge status={val} size="sm" />,
    },
    {
      key: "private_ip",
      label: "Private VPC IP",
      sortable: true,
      render: (val) => (
        <span className="font-mono text-xs text-primary">{val || "10.0.1.X"}</span>
      ),
    },
    {
      key: "mysql_port",
      label: "MySQL Port",
      sortable: true,
      render: (val) => <span className="port-badge">{val || 3307}</span>,
    },
    {
      key: "tenant_count",
      label: "Tenant Capacity",
      sortable: true,
      render: (_, row) => {
        const count = row.tenant_count || 0;
        const cap = row.capacity || 5;
        const pct = Math.min(100, Math.round((count / cap) * 100));

        let barColor = "bg-green";
        if (pct >= 100) barColor = "bg-red";
        else if (pct >= 80) barColor = "bg-amber";

        return (
          <div className="capacity-cell">
            <div className="capacity-label">
              <strong>{count}</strong> / {cap} tenants ({pct}%)
            </div>
            <div className="capacity-bar-track">
              <div
                className={`capacity-bar-fill ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: "available_capacity",
      label: "Available Slots",
      sortable: true,
      render: (_, row) => {
        const avail =
          row.available_capacity ??
          Math.max(0, (row.capacity || 5) - (row.tenant_count || 0));
        return (
          <span
            className={`font-semibold ${
              avail === 0 ? "text-red" : "text-green"
            }`}
          >
            {avail} {avail === 1 ? "slot" : "slots"}
          </span>
        );
      },
    },
    {
      key: "subnet_id",
      label: "Subnet ID",
      sortable: true,
      render: (val) => (
        <span className="font-mono text-xs text-muted">
          {val || "subnet-private-a"}
        </span>
      ),
    },
    {
      key: "created_at",
      label: "Registered",
      sortable: true,
      render: (val) => (
        <span className="text-sm text-muted">{formatDate(val)}</span>
      ),
    },
  ];

  return (
    <div className="hosts-page page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">EC2 MySQL Hosts</h1>
          <p className="page-subtitle">
            Shared database server instances, capacity thresholds, and VPC placement.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={() => loadHosts(true)}
            disabled={refreshing}
            title="Refresh hosts from AWS DynamoDB"
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Aggregate Cards */}
      <div className="kpi-grid mb-6">
        <div className="dashboard-card kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Total Hosts</span>
            <div className="kpi-icon-box bg-purple">
              <Server size={20} />
            </div>
          </div>
          <div className="kpi-value">{totalHosts}</div>
          <div className="kpi-meta">Registered EC2 instances</div>
        </div>

        <div className="dashboard-card kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Ready Hosts</span>
            <div className="kpi-icon-box bg-green">
              <Activity size={20} />
            </div>
          </div>
          <div className="kpi-value text-green">{readyHosts}</div>
          <div className="kpi-meta">Verified MySQL port 3307</div>
        </div>

        <div className="dashboard-card kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Total Slots</span>
            <div className="kpi-icon-box bg-blue">
              <Layers size={20} />
            </div>
          </div>
          <div className="kpi-value">{totalSlots}</div>
          <div className="kpi-meta">5 tenants per host limit</div>
        </div>

        <div className="dashboard-card kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Available Slots</span>
            <div className="kpi-icon-box bg-teal">
              <Database size={20} />
            </div>
          </div>
          <div className="kpi-value text-teal">{availableSlots}</div>
          <div className="kpi-meta">Before new EC2 launch needed</div>
        </div>
      </div>

      {/* Main Hosts Table */}
      <div className="dashboard-card">
        <SafeTable
          columns={columns}
          data={hosts}
          isLoading={loading}
          emptyTitle="No EC2 MySQL Hosts"
          emptyDesc="No hosts registered in DynamoDB yet. Launching a tenant will automatically trigger host placement and EC2 provisioning if needed."
          searchPlaceholder="Search hosts by ID, IP, or subnet..."
          pageSize={10}
        />
      </div>
    </div>
  );
}
