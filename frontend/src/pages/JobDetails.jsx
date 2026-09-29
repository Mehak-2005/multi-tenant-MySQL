import { useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Terminal,
  Check,
} from "lucide-react";
import { getJob } from "../services/api";
import { usePolling } from "../hooks/usePolling";
import StatusBadge from "../components/StatusBadge";
import { formatDate, formatDuration, formatRelativeTime } from "../utils/formatters";
import { STATUS_CONFIG, PROVISIONING_STAGES } from "../constants/states";
import { useToast } from "../hooks/useToast";

export default function JobDetails() {
  const { jobId } = useParams();
  const toast = useToast();
  const navigate = useNavigate();

  const fetchJobFn = useCallback(async () => {
    return await getJob(jobId);
  }, [jobId]);

  const {
    data: job,
    isPolling,
    lastUpdated,
    refresh,
    stop,
  } = usePolling(fetchJobFn, {
    interval: 3000,
    timeout: 180000,
    onComplete: (completedJob) => {
      if (completedJob.status === "READY") {
        toast.success(`Job completed! Tenant "${completedJob.tenant_id}" is now READY.`);
      } else if (completedJob.status === "FAILED") {
        toast.error(`Provisioning job failed. Check error log below.`);
      }
    },
    onError: (err) => {
      toast.error(err.message || "Error polling job status.");
    },
  });

  const status = job?.status || "PENDING";
  const stage = job?.stage || "API_REQUEST";
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const progressPercent = statusCfg.progress || 10;

  // Determine stage progression index
  const stageOrder = [
    "API_REQUEST",
    "STEP_FUNCTIONS_STARTED",
    "FIND_RESERVE_HOST",
    "BOOTSTRAP_HOST",
    "READINESS_CHECK",
    "TENANT_PROVISION",
    "READY",
  ];

  let currentStageIndex = stageOrder.indexOf(stage);
  if (currentStageIndex === -1) {
    if (status === "READY") currentStageIndex = 6;
    else if (status === "BOOTSTRAPPING") currentStageIndex = 3;
    else currentStageIndex = 1;
  }

  return (
    <div className="job-details-page page-container">
      {/* Back button */}
      <div className="mb-4">
        <Link to="/jobs" className="back-link">
          <ArrowLeft size={16} />
          <span>Back to Jobs</span>
        </Link>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="page-title font-mono">Job Details</h1>
            <StatusBadge status={status} size="md" />
            {isPolling && (
              <span className="live-polling-badge" title="Actively polling AWS DynamoDB">
                <span className="pulse-dot green" />
                Live Polling (3s)
              </span>
            )}
          </div>
          <p className="page-subtitle font-mono text-sm mt-1">{jobId}</p>
        </div>

        <div className="header-actions">
          {isPolling ? (
            <button className="secondary-button" onClick={stop}>
              Pause Polling
            </button>
          ) : (
            <button className="secondary-button" onClick={refresh}>
              <RefreshCw size={15} />
              <span>Resume Polling</span>
            </button>
          )}
          {status === "READY" && job?.tenant_id && (
            <>
              <button
                className="secondary-button"
                onClick={() =>
                  navigate(`/tenants/${encodeURIComponent(job.tenant_id)}/query`)
                }
              >
                <Terminal size={16} />
                <span>Query DB</span>
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  navigate(`/tenants/${encodeURIComponent(job.tenant_id)}`)
                }
              >
                <span>View Tenant Details</span>
                <ExternalLink size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error Banner if Job Failed */}
      {status === "FAILED" && (
        <div className="error-banner mb-6">
          <div className="error-banner-icon">
            <AlertCircle size={22} />
          </div>
          <div className="error-banner-content">
            <h4 className="error-banner-title">
              Provisioning Failed {job?.error_code ? `(${job.error_code})` : ""}
            </h4>
            <p className="error-banner-desc">
              {job?.error ||
                "An unexpected error occurred during EC2 launch or MySQL readiness check. The reserved host slot has been rolled back."}
            </p>
          </div>
        </div>
      )}

      {/* Progress Bar & Status Summary */}
      <div className="dashboard-card mb-6">
        <div className="progress-header">
          <div>
            <h3 className="card-section-title">Orchestration Progress</h3>
            <p className="text-sm text-muted">
              {statusCfg.description}
            </p>
          </div>
          <div className="progress-percentage-label">
            <span className="percent-val">{progressPercent}%</span>
            <span className="percent-note">State-based progress indicator</span>
          </div>
        </div>

        <div className="progress-track-wrapper">
          <div
            className={`progress-fill ${
              status === "FAILED"
                ? "bg-red"
                : status === "READY"
                ? "bg-green"
                : "bg-blue"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="progress-meta-footer">
          <span className="meta-item">
            <strong>Started:</strong> {formatDate(job?.created_at)}
          </span>
          <span className="meta-item">
            <strong>Elapsed:</strong> {formatDuration(job?.created_at, job?.updated_at)}
          </span>
          <span className="meta-item">
            <strong>Last Polled:</strong> {lastUpdated ? formatRelativeTime(lastUpdated) : "—"}
          </span>
        </div>
      </div>

      {/* Visual Timeline Section */}
      <div className="dashboard-card mb-6">
        <h3 className="card-section-title mb-4">Provisioning Pipeline Timeline</h3>
        <div className="visual-timeline">
          {PROVISIONING_STAGES.map((stg, idx) => {
            const isCompleted =
              status === "READY" || (status !== "FAILED" && idx <= currentStageIndex);
            const isCurrent =
              status !== "READY" && status !== "FAILED" && idx === currentStageIndex;
            const isFailedStep = status === "FAILED" && idx === currentStageIndex;

            let stepClass = "timeline-pending";
            if (isFailedStep) stepClass = "timeline-failed";
            else if (isCompleted) stepClass = "timeline-completed";
            else if (isCurrent) stepClass = "timeline-active";

            return (
              <div key={stg.key} className={`timeline-step-item ${stepClass}`}>
                <div className="timeline-node">
                  {isFailedStep ? (
                    <AlertCircle size={16} />
                  ) : isCompleted ? (
                    <Check size={16} />
                  ) : isCurrent ? (
                    <RefreshCw size={15} className="spin" />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>

                <div className="timeline-content">
                  <h4 className="timeline-step-title">{stg.title}</h4>
                  <p className="timeline-step-desc">{stg.description}</p>
                  {isCurrent && (
                    <span className="timeline-in-progress-tag">
                      In Progress...
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Metadata Details Grid */}
      <div className="job-meta-grid">
        <div className="dashboard-card">
          <h3 className="card-section-title">Job Information</h3>
          <div className="metadata-list">
            <div className="metadata-row">
              <span className="metadata-label">Job ID</span>
              <span className="metadata-value font-mono">{job?.job_id || jobId}</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Tenant ID</span>
              <span className="metadata-value font-semibold text-primary">
                {job?.tenant_id ? (
                  <Link
                    to={`/tenants/${encodeURIComponent(job.tenant_id)}`}
                    className="table-link"
                  >
                    {job.tenant_id}
                  </Link>
                ) : (
                  "—"
                )}
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Status</span>
              <span className="metadata-value">
                <StatusBadge status={status} size="sm" />
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Workflow Stage</span>
              <span className="metadata-value font-mono text-xs stage-tag">
                {stage}
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Environment</span>
              <span className="metadata-value">{job?.environment || "dev"}</span>
            </div>
          </div>
        </div>

        <div className="dashboard-card">
          <h3 className="card-section-title">AWS Step Functions Execution</h3>
          <div className="metadata-list">
            <div className="metadata-row">
              <span className="metadata-label">Execution ARN</span>
              <span
                className="metadata-value font-mono text-xs truncate"
                title={job?.state_machine_execution_arn}
              >
                {job?.state_machine_execution_arn || "Registered via Lambda"}
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Execution Start Date</span>
              <span className="metadata-value text-sm">
                {formatDate(job?.execution_start_date || job?.created_at)}
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Target MySQL Host</span>
              <span className="metadata-value font-mono text-sm">
                {job?.target_host?.host_id ||
                  job?.host_id ||
                  (status === "READY" ? "Allocated" : "Pending host reservation")}
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Last State Transition</span>
              <span className="metadata-value text-sm text-muted">
                {formatDate(job?.updated_at)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
