import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  RefreshCw,
  Server,
  Cloud,
  Lock,
  Cpu,
  Layers,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { getSystemHealth } from "../services/api";
import StatusBadge from "../components/StatusBadge";
import { formatDate, formatRelativeTime } from "../utils/formatters";
import { useToast } from "../hooks/useToast";

export default function SystemHealth() {
  const [healthData, setHealthData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const toast = useToast();

  const loadHealth = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);

    try {
      const data = await getSystemHealth();
      setHealthData(data);
      setLastChecked(new Date());
    } catch (err) {
      toast.error(err.message || "Failed to reach health endpoint.");
      setHealthData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const serviceIcons = {
    api_gateway: Cloud,
    lambda: Cpu,
    dynamodb: Layers,
    step_functions: Activity,
    ec2_hosts: Server,
    s3: HardDrive,
    secrets_manager: Lock,
  };

  const services = healthData?.services || {};

  return (
    <div className="health-page page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">System Health & Telemetry</h1>
          <p className="page-subtitle">
            Live availability and response metrics for AWS Serverless components.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="primary-button"
            onClick={() => loadHealth(true)}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            <span>{refreshing ? "Running Health Check..." : "Run Health Check"}</span>
          </button>
        </div>
      </div>

      {/* Overall Health Status Banner */}
      <div className="dashboard-card health-summary-banner mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div
              className={`health-large-icon ${
                healthData?.status === "Healthy"
                  ? "bg-green-light text-green"
                  : healthData?.status === "Warning"
                  ? "bg-amber-light text-amber"
                  : "bg-red-light text-red"
              }`}
            >
              {healthData?.status === "Healthy" ? (
                <CheckCircle2 size={32} />
              ) : healthData?.status === "Warning" ? (
                <AlertTriangle size={32} />
              ) : (
                <AlertCircle size={32} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">
                  Fleet Status: {healthData?.status || "Unknown"}
                </h2>
                <StatusBadge status={healthData?.status || "UNKNOWN"} size="md" />
              </div>
              <p className="text-sm text-muted mt-1">
                Environment: <strong>{healthData?.environment || "dev"}</strong> | Region:{" "}
                <strong>{healthData?.region || "ap-south-1"}</strong>
              </p>
            </div>
          </div>

          <div className="text-right text-xs text-muted">
            <div>Last Polled: {lastChecked ? formatDate(lastChecked) : "—"}</div>
            <div>({lastChecked ? formatRelativeTime(lastChecked) : "not yet checked"})</div>
          </div>
        </div>
      </div>

      {/* Services Grid */}
      <h3 className="section-heading mb-4">AWS Infrastructure Components</h3>
      <div className="health-grid">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="dashboard-card health-service-card skeleton-card">
              <div className="skeleton-loader h-6 w-1/2 mb-3" />
              <div className="skeleton-loader h-4 w-3/4 mb-2" />
              <div className="skeleton-loader h-4 w-1/3" />
            </div>
          ))
        ) : !healthData ? (
          <div className="dashboard-card col-span-full text-center p-8">
            <AlertCircle size={36} className="text-red mx-auto mb-2" />
            <h3>Unable to Contact Backend Health API</h3>
            <p className="text-muted mt-1">
              Verify that the API Gateway endpoint is deployed and reachable.
            </p>
          </div>
        ) : (
          Object.entries(services).map(([key, svc]) => {
            const Icon = serviceIcons[key] || Activity;

            return (
              <div key={key} className="dashboard-card health-service-card">
                <div className="health-card-top">
                  <div className="health-card-icon-box">
                    <Icon size={20} />
                  </div>
                  <StatusBadge status={svc.status} size="sm" />
                </div>

                <h4 className="health-card-title">{svc.name || key}</h4>

                <div className="health-card-details">
                  {svc.latency_ms !== undefined && (
                    <div className="health-metric-row">
                      <span className="metric-label">Ping Latency:</span>
                      <span className="metric-val text-green font-mono">
                        {svc.latency_ms}ms
                      </span>
                    </div>
                  )}

                  {svc.details && (
                    <div className="health-metric-row">
                      <span className="metric-label">Tables:</span>
                      <span className="metric-val text-xs truncate" title={svc.details}>
                        {svc.details}
                      </span>
                    </div>
                  )}

                  {svc.arn && (
                    <div className="health-metric-row">
                      <span className="metric-label">State Machine:</span>
                      <span className="metric-val text-xs font-mono truncate" title={svc.arn}>
                        {svc.arn.split(":").pop()}
                      </span>
                    </div>
                  )}

                  {svc.ready_hosts !== undefined && (
                    <div className="health-metric-row">
                      <span className="metric-label">EC2 Hosts:</span>
                      <span className="metric-val font-semibold">
                        {svc.ready_hosts} Ready / {svc.total_hosts} Total
                      </span>
                    </div>
                  )}

                  {svc.bucket && (
                    <div className="health-metric-row">
                      <span className="metric-label">S3 Bucket:</span>
                      <span className="metric-val font-mono text-xs">{svc.bucket}</span>
                    </div>
                  )}

                  {svc.note && (
                    <div className="health-metric-row">
                      <span className="metric-label">Policy:</span>
                      <span className="metric-val text-xs">{svc.note}</span>
                    </div>
                  )}

                  {svc.error && (
                    <div className="health-card-error">
                      <AlertCircle size={14} className="text-red flex-shrink-0" />
                      <span className="text-xs text-red font-mono">{svc.error}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
