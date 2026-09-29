import { useState } from "react";
import {
  Cloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FlaskConical,
  Layers,
  Save,
  RotateCcw,
} from "lucide-react";
import {
  getApiBaseUrl,
  setCustomApiBaseUrl,
  isMockDataEnabled,
  setMockDataEnabled,
  checkConnection,
} from "../services/api";
import { DEFAULT_REGION, DEFAULT_ENV } from "../constants/states";
import { useToast } from "../hooks/useToast";

export default function Settings() {
  const [apiUrl, setApiUrl] = useState(getApiBaseUrl());
  const [useMock, setUseMock] = useState(isMockDataEnabled());
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState(null);
  const toast = useToast();

  const handleSaveApiUrl = (e) => {
    e.preventDefault();
    setCustomApiBaseUrl(apiUrl);
    toast.success("API configuration updated.");
  };

  const handleResetApiUrl = () => {
    localStorage.removeItem("custom_api_base_url");
    const defaultUrl = import.meta.env.VITE_API_BASE_URL || "";
    setApiUrl(defaultUrl);
    toast.info("Reset to build-time environment variable.");
  };

  const handleToggleMock = (e) => {
    const val = e.target.checked;
    setUseMock(val);
    setMockDataEnabled(val);
    toast.info(val ? "Mock mode activated for offline demo." : "Connected to real AWS backend APIs.");
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const res = await checkConnection();
      setConnectionResult(res);
      if (res.connected) {
        toast.success("Connection to AWS API Gateway successful!");
      } else {
        toast.error(res.error || "Connection failed.");
      }
    } catch (err) {
      setConnectionResult({ connected: false, error: err.message });
      toast.error("Failed to connect to API Gateway.");
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="settings-page page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Platform Settings</h1>
          <p className="page-subtitle">
            Configure backend API Gateway endpoints, mock testing mode, and deployment metadata.
          </p>
        </div>
      </div>

      <div className="settings-grid">
        {/* API Configuration Card */}
        <div className="dashboard-card mb-6">
          <div className="card-title-group mb-3">
            <Cloud size={18} className="text-blue" />
            <h3>AWS API Gateway Configuration</h3>
          </div>
          <p className="text-sm text-muted mb-4">
            The base URL for all tenant provisioning, query, backup, and health REST API endpoints.
          </p>

          <form onSubmit={handleSaveApiUrl}>
            <div className="form-field mb-4">
              <label htmlFor="apiBaseUrl" className="form-label">
                API Base URL (<code>VITE_API_BASE_URL</code>)
              </label>
              <input
                id="apiBaseUrl"
                type="text"
                className="form-input font-mono text-sm"
                placeholder="https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/Prod"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
              <p className="field-hint">
                Standard format: <code>https://&#123;restApiId&#125;.execute-api.&#123;region&#125;.amazonaws.com/Prod</code>
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" className="primary-button">
                <Save size={15} />
                <span>Save Base URL</span>
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleTestConnection}
                disabled={testingConnection}
              >
                <RefreshCw size={15} className={testingConnection ? "spin" : ""} />
                <span>{testingConnection ? "Testing..." : "Test Connection"}</span>
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleResetApiUrl}
              >
                <RotateCcw size={15} />
                <span>Reset to Default</span>
              </button>
            </div>
          </form>

          {/* Test Connection Output */}
          {connectionResult && (
            <div
              className={`test-result-box mt-4 ${
                connectionResult.connected ? "test-success" : "test-fail"
              }`}
            >
              {connectionResult.connected ? (
                <>
                  <CheckCircle2 size={18} className="text-green flex-shrink-0" />
                  <div>
                    <strong>Connection Verified:</strong> Successfully contacted AWS API Gateway &amp; Lambda.
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle size={18} className="text-red flex-shrink-0" />
                  <div>
                    <strong>Connection Failed:</strong> {connectionResult.error || connectionResult.reason}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Development & Mock Mode Card */}
        <div className="dashboard-card mb-6">
          <div className="card-title-group mb-3">
            <FlaskConical size={18} className="text-purple" />
            <h3>Development &amp; Mock Mode</h3>
          </div>
          <p className="text-sm text-muted mb-4">
            Allows offline demonstration or UI testing when AWS credentials or an active stack are not available. Defaults to <code>false</code> in production.
          </p>

          <label className="toggle-label-row">
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={useMock}
              onChange={handleToggleMock}
            />
            <div>
              <div className="font-semibold text-sm">
                Enable Isolated Mock Data (<code>VITE_USE_MOCK_DATA</code>)
              </div>
              <div className="text-xs text-muted">
                Simulates real AWS asynchronous provisioning, polling transitions, and health checks entirely inside <code>mockData.js</code>.
              </div>
            </div>
          </label>
        </div>

        {/* AWS Architecture Metadata Card */}
        <div className="dashboard-card">
          <div className="card-title-group mb-3">
            <Layers size={18} className="text-teal" />
            <h3>AWS Architecture Topology</h3>
          </div>
          <div className="metadata-list text-sm">
            <div className="metadata-row">
              <span className="metadata-label">AWS Region:</span>
              <span className="metadata-value font-mono">
                {import.meta.env.VITE_AWS_REGION || DEFAULT_REGION}
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Environment:</span>
              <span className="metadata-value font-mono">
                {import.meta.env.VITE_ENVIRONMENT || DEFAULT_ENV}
              </span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">SAM Stack Name:</span>
              <span className="metadata-value font-mono">multi-tenant-mysql</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">MySQL Port:</span>
              <span className="metadata-value font-mono">3307 (Non-default hardened)</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Max Tenants Per Host:</span>
              <span className="metadata-value font-mono">5</span>
            </div>
            <div className="metadata-row">
              <span className="metadata-label">Frontend Deployment:</span>
              <span className="metadata-value">Vercel (Single-Page Application)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
