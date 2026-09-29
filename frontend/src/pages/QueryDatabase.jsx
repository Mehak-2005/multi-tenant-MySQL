import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Terminal,
  Play,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Database,
} from "lucide-react";
import { getTenants, queryTenant } from "../services/api";
import { useToast } from "../hooks/useToast";

export default function QueryDatabase() {
  const { tenantId: routeTenantId } = useParams();
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(routeTenantId || "");
  const [sql, setSql] = useState("SELECT 1;");
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [durationMs, setDurationMs] = useState(null);

  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    async function loadTenantsList() {
      try {
        const data = await getTenants();
        const list = data?.tenants || [];
        if (!isMounted) return;
        setTenants(list);
        if (!tenantId && list.length > 0) {
          const firstReady = list.find((t) => t.status === "READY");
          const target = firstReady ? firstReady.tenant_id : list[0].tenant_id;
          setSelectedTenant(target);
          navigate(`/tenants/${encodeURIComponent(target)}/query`, { replace: true });
        }
      } catch {
        if (isMounted) toast.error("Could not fetch tenant list.");
      }
    }
    loadTenantsList();
    return () => {
      isMounted = false;
    };
  }, []); // Run once on mount

  const handleSelectTenant = (newTenantId) => {
    setSelectedTenant(newTenantId);
    navigate(`/tenants/${encodeURIComponent(newTenantId)}/query`, { replace: true });
    setResult(null);
    setErrorMsg("");
  };

  const handleExecuteQuery = async (e) => {
    if (e) e.preventDefault();
    if (!selectedTenant) {
      toast.error("Please select a tenant database.");
      return;
    }
    if (!sql.trim()) {
      toast.error("Please enter a SQL statement.");
      return;
    }

    setExecuting(true);
    setResult(null);
    setErrorMsg("");
    const startTime = performance.now();

    try {
      const res = await queryTenant(selectedTenant, sql.trim());
      const elapsed = Math.round(performance.now() - startTime);
      setDurationMs(elapsed);
      setResult(res);
      toast.success("Query executed successfully.");
    } catch (err) {
      const elapsed = Math.round(performance.now() - startTime);
      setDurationMs(elapsed);
      const msg = err.message || "Failed to execute SQL query.";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setExecuting(false);
    }
  };

  const templates = [
    { label: "Health Check", query: "SELECT 1;" },
    { label: "Show Tables", query: "SHOW TABLES;" },
    {
      label: "Create Table",
      query: "CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(64) NOT NULL, email VARCHAR(128), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
    },
    {
      label: "Insert Row",
      query: "INSERT INTO users (username, email) VALUES ('dev_user', 'dev@cloud.internal');",
    },
    { label: "Select Rows", query: "SELECT * FROM users LIMIT 10;" },
  ];

  // Extract columns and rows from result
  const rows = result?.rows || [];
  const columns = rows.length > 0 && typeof rows[0] === "object" ? Object.keys(rows[0]) : [];

  return (
    <div className="query-page page-container">
      {/* Back button */}
      <div className="mb-4">
        <Link to="/tenants" className="back-link">
          <ArrowLeft size={16} />
          <span>Back to Tenants</span>
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Tenant SQL Console</h1>
          <p className="page-subtitle">
            Execute SQL statements securely within an isolated tenant database sandbox.
          </p>
        </div>
      </div>

      {/* Security & Isolation Callout */}
      <div className="security-notice-callout mb-6">
        <ShieldCheck size={22} className="text-blue flex-shrink-0" />
        <div>
          <strong>Strict Security Boundaries:</strong>
          <p className="text-xs text-muted mt-1">
            Queries execute via AWS API Gateway and Lambda proxy with database-scoped MySQL user privileges. Cross-database queries and administrative statements (<code>GRANT</code>, <code>DROP DATABASE</code>, <code>USE</code>, <code>CREATE USER</code>) are blocked by both application security and MySQL grant tables.
          </p>
        </div>
      </div>

      {/* Query Console Card */}
      <div className="dashboard-card mb-6">
        {/* Tenant Selector & Actions Bar */}
        <div className="query-toolbar">
          <div className="tenant-selector-group">
            <label htmlFor="tenantSelect" className="selector-label">
              <Database size={16} className="text-blue" />
              <span>Target Tenant:</span>
            </label>
            <select
              id="tenantSelect"
              className="tenant-select-dropdown"
              value={selectedTenant}
              onChange={(e) => handleSelectTenant(e.target.value)}
              disabled={executing}
            >
              <option value="" disabled>
                Select a tenant database...
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
              onClick={handleExecuteQuery}
              disabled={executing || !selectedTenant || !sql.trim()}
            >
              <Play size={15} />
              <span>{executing ? "Executing..." : "Run Query"}</span>
            </button>
          </div>
        </div>

        {/* Quick Query Templates */}
        <div className="templates-bar">
          <span className="templates-label">
            <Sparkles size={14} className="text-amber" />
            <span>Templates:</span>
          </span>
          <div className="template-pills">
            {templates.map((tpl, i) => (
              <button
                key={i}
                type="button"
                className="template-pill"
                onClick={() => setSql(tpl.query)}
                disabled={executing}
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {/* SQL Editor Input */}
        <div className="sql-editor-container">
          <textarea
            className="sql-editor-textarea font-mono"
            rows={5}
            placeholder="SELECT * FROM table LIMIT 10;"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            disabled={executing}
          />
        </div>
      </div>

      {/* Query Results / Output Section */}
      <div className="dashboard-card">
        <div className="card-header-bar mb-3">
          <div className="card-title-group">
            <Terminal size={18} className="text-purple" />
            <h3>Execution Output</h3>
          </div>
          {durationMs !== null && (
            <div className="query-timing-badge">
              <Clock size={13} />
              <span>{durationMs}ms</span>
            </div>
          )}
        </div>

        {/* Error Output */}
        {errorMsg && (
          <div className="error-banner mb-4">
            <AlertCircle size={20} className="flex-shrink-0" />
            <div>
              <strong>Execution Error:</strong>
              <p className="font-mono text-xs mt-1">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Success Output */}
        {result && !errorMsg && (
          <div className="query-success-info mb-4">
            <CheckCircle2 size={18} className="text-green" />
            <span>
              {result.message || "Query executed successfully."} Affected rows:{" "}
              <strong>{result.affected_rows ?? 0}</strong>. Database:{" "}
              <code>{result.database_name || "tenant_db"}</code>.
            </span>
          </div>
        )}

        {/* Table Renderer */}
        {executing ? (
          <div className="p-8 text-center text-muted">
            <div className="spin inline-block mb-2">
              <RotateCcw size={24} />
            </div>
            <p>Executing SQL query on remote MySQL host...</p>
          </div>
        ) : rows.length === 0 && result ? (
          <div className="card-empty-inline">
            <p>Query executed successfully (0 rows returned).</p>
          </div>
        ) : rows.length > 0 ? (
          <div className="table-responsive max-h-96">
            <table className="safe-table query-results-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="font-mono text-xs">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {columns.map((col) => (
                      <td key={col} className="font-mono text-xs">
                        {row[col] !== null && row[col] !== undefined
                          ? String(row[col])
                          : <span className="text-muted italic">NULL</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !errorMsg ? (
          <div className="card-empty-inline">
            <p>Enter a query above and click &quot;Run Query&quot; to inspect output.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
