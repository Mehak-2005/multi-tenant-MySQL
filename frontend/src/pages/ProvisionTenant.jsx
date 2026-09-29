import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Server,
  ArrowLeft,
  Loader2,
  ShieldCheck,
  Cpu,
} from "lucide-react";
import { provisionTenant } from "../services/api";
import { useToast } from "../hooks/useToast";

export default function ProvisionTenant() {
  const [tenantId, setTenantId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const toast = useToast();
  const navigate = useNavigate();

  const validateTenantId = (id) => {
    if (!id.trim()) {
      return "Tenant ID is required.";
    }
    if (id.length < 3 || id.length > 50) {
      return "Tenant ID must be between 3 and 50 characters.";
    }
    // Alphanumeric, hyphen, underscore
    if (!/^[a-zA-Z0-9-_]+$/.test(id)) {
      return "Tenant ID can only contain letters, numbers, hyphens, and underscores.";
    }
    return null;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const cleanId = tenantId.trim();

    const validationError = validateTenantId(cleanId);
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setSubmitting(true);
    setErrorMsg("");

    try {
      const response = await provisionTenant(cleanId);
      const jobId = response.job_id;

      toast.success(
        `Provisioning workflow started for "${cleanId}" (Job: ${jobId.substring(0, 8)}...).`
      );

      // Navigate to Job Details tracking page
      navigate(`/jobs/${jobId}`);
    } catch (err) {
      const msg = err.message || "Failed to start tenant provisioning.";
      setErrorMsg(msg);
      toast.error(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="provision-page page-container">
      {/* Back button */}
      <div className="mb-4">
        <Link to="/tenants" className="back-link">
          <ArrowLeft size={16} />
          <span>Back to Tenants</span>
        </Link>
      </div>

      <div className="page-header mb-6">
        <div>
          <h1 className="page-title">Provision New Tenant</h1>
          <p className="page-subtitle">
            Initiate asynchronous AWS Step Functions workflow to allocate a MySQL database.
          </p>
        </div>
      </div>

      <div className="provision-grid">
        {/* Form Column */}
        <div className="dashboard-card provision-form-card">
          <div className="form-card-header">
            <div className="form-icon-box">
              <Server size={24} />
            </div>
            <div>
              <h3>Tenant Specification</h3>
              <p className="text-muted text-sm">
                Enter a unique identifier for this tenant.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="provision-form">
            <div className="form-field">
              <label htmlFor="tenantId" className="form-label">
                Tenant Identifier <span className="text-red">*</span>
              </label>
              <input
                id="tenantId"
                type="text"
                className={`form-input ${errorMsg ? "input-error" : ""}`}
                placeholder="e.g. tenant-corp-001"
                value={tenantId}
                onChange={(e) => {
                  setTenantId(e.target.value);
                  if (errorMsg) setErrorMsg("");
                }}
                disabled={submitting}
                autoFocus
              />
              <p className="field-hint">
                Must be unique. Alphanumeric characters, hyphens, and underscores only.
              </p>
              {errorMsg && <p className="field-error-msg">{errorMsg}</p>}
            </div>

            <div className="form-info-callout">
              <ShieldCheck size={18} className="text-blue flex-shrink-0" />
              <div className="text-xs">
                <strong>Automatic Isolation:</strong> The orchestration workflow creates a dedicated MySQL database (<code>tenant_&lt;id&gt;_db</code>) and user with scoped permissions, storing generated credentials in AWS Secrets Manager.
              </div>
            </div>

            <button
              type="submit"
              className="primary-button submit-btn"
              disabled={submitting || !tenantId.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Submitting Provisioning Job...</span>
                </>
              ) : (
                <>
                  <Server size={18} />
                  <span>Start Provisioning Workflow</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* AWS Orchestration Architecture Explanation */}
        <div className="dashboard-card provision-info-card">
          <h3 className="card-section-title">
            <Cpu size={18} className="text-purple" />
            Provisioning Pipeline
          </h3>
          <p className="text-sm text-muted mb-4">
            Provisioning is completely asynchronous and handled via AWS Serverless:
          </p>

          <div className="pipeline-steps">
            <div className="pipeline-step">
              <div className="step-num">1</div>
              <div className="step-content">
                <strong>API Gateway & Lambda:</strong>
                <p>Creates a <code>PENDING</code> job in DynamoDB and invokes AWS Step Functions.</p>
              </div>
            </div>

            <div className="pipeline-step">
              <div className="step-num">2</div>
              <div className="step-content">
                <strong>Host Placement:</strong>
                <p>Scans DynamoDB for a <code>READY</code> EC2 host with available capacity (&lt; 5 tenants). Performs atomic reservation.</p>
              </div>
            </div>

            <div className="pipeline-step">
              <div className="step-num">3</div>
              <div className="step-content">
                <strong>On-Demand EC2 Launch:</strong>
                <p>If all hosts are full, launches a new Ubuntu 24.04 EC2 instance, bootstraps MySQL on non-default port <code>3307</code>, and hardens configuration.</p>
              </div>
            </div>

            <div className="pipeline-step">
              <div className="step-num">4</div>
              <div className="step-content">
                <strong>MySQL Readiness Verification:</strong>
                <p>Verifies MySQL accepts connections on port 3307 and executes a health query before marking host ready.</p>
              </div>
            </div>

            <div className="pipeline-step">
              <div className="step-num">5</div>
              <div className="step-content">
                <strong>Tenant Database Provisioning:</strong>
                <p>Generates isolated database, random credentials, stores secret in AWS Secrets Manager, and marks job <code>READY</code>.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}