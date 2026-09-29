import { CheckCircle2, Clock3, AlertCircle, RefreshCw, XCircle, Ban } from "lucide-react";
import { STATUS_CONFIG } from "../constants/states";

export default function StatusBadge({ status, size = "md", showIcon = true }) {
  const normStatus = String(status || "UNKNOWN").toUpperCase();
  const config = STATUS_CONFIG[normStatus] || {
    label: normStatus,
    color: "#6b7280",
    bg: "#f3f4f6",
    border: "#e5e7eb",
  };

  const getIcon = () => {
    switch (normStatus) {
      case "READY":
      case "COMPLETED":
        return <CheckCircle2 size={size === "sm" ? 12 : 14} />;
      case "BOOTSTRAPPING":
      case "IN_PROGRESS":
        return <RefreshCw size={size === "sm" ? 12 : 14} className="spin" />;
      case "PENDING":
        return <Clock3 size={size === "sm" ? 12 : 14} />;
      case "FAILED":
        return <AlertCircle size={size === "sm" ? 12 : 14} />;
      case "TERMINATED":
        return <Ban size={size === "sm" ? 12 : 14} />;
      default:
        return <XCircle size={size === "sm" ? 12 : 14} />;
    }
  };

  return (
    <span
      className={`status-badge status-badge-${size}`}
      style={{
        backgroundColor: config.bg,
        color: config.color,
        borderColor: config.border,
      }}
    >
      {showIcon && <span className="status-badge-icon">{getIcon()}</span>}
      <span className="status-badge-text">{config.label}</span>
    </span>
  );
}
