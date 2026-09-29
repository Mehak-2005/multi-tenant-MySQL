import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Menu,
  Shield,
  MapPin,
  Activity,
  LogOut,
  User,
  FlaskConical,
  Wifi,
  WifiOff,
} from "lucide-react";
import { isMockDataEnabled, checkConnection } from "../services/api";
import { DEFAULT_REGION, DEFAULT_ENV } from "../constants/states";

export default function Topbar({ onToggleMobile }) {
  const [connectionStatus, setConnectionStatus] = useState("checking"); // 'connected' | 'offline' | 'checking'
  const isMock = isMockDataEnabled();

  const awsRegion = import.meta.env.VITE_AWS_REGION || DEFAULT_REGION;
  const envName = import.meta.env.VITE_ENVIRONMENT || DEFAULT_ENV;

  useEffect(() => {
    let isMounted = true;
    async function verifyLiveConnection() {
      try {
        const res = await checkConnection();
        if (isMounted) {
          setConnectionStatus(res.connected ? "connected" : "offline");
        }
      } catch {
        if (isMounted) {
          setConnectionStatus("offline");
        }
      }
    }

    verifyLiveConnection();
    const interval = setInterval(verifyLiveConnection, 30000); // Check every 30s
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="mobile-menu-trigger"
          onClick={onToggleMobile}
          aria-label="Open mobile navigation"
        >
          <Menu size={22} />
        </button>

        <div className="topbar-title-group">
          <h2 className="topbar-title">Multi-Tenant MySQL Provisioner</h2>
          <span className="topbar-subtitle">
            AWS Serverless Infrastructure Control Plane
          </span>
        </div>
      </div>

      <div className="topbar-right">
        {/* Mock Mode Indicator if enabled */}
        {isMock && (
          <Link
            to="/settings"
            className="topbar-badge badge-mock"
            title="Running in local mock mode. Click to configure in Settings."
          >
            <FlaskConical size={13} />
            <span>MOCK MODE</span>
          </Link>
        )}

        {/* Environment Badge */}
        <span className="topbar-badge badge-env" title="Deployment Environment">
          <Shield size={13} />
          <span>{envName.toUpperCase()}</span>
        </span>

        {/* AWS Region Badge */}
        <span className="topbar-badge badge-region" title="AWS Region">
          <MapPin size={13} />
          <span>{awsRegion}</span>
        </span>

        {/* Live API Health Indicator */}
        <Link
          to="/health"
          className={`topbar-connection-indicator status-${connectionStatus}`}
          title={`API Status: ${connectionStatus === "connected" ? "Live & Reachable" : "API Offline / Disconnected"}`}
        >
          {connectionStatus === "connected" ? (
            <>
              <span className="pulse-dot green" />
              <Wifi size={14} />
              <span className="indicator-label">API Online</span>
            </>
          ) : (
            <>
              <span className="pulse-dot red" />
              <WifiOff size={14} />
              <span className="indicator-label">Offline</span>
            </>
          )}
        </Link>

        {/* Admin Profile */}
        <div className="topbar-user">
          <div className="user-avatar" title="AWS Administrator">
            <User size={16} />
          </div>
          <div className="user-details">
            <span className="user-name">Cloud Admin</span>
            <span className="user-role">Administrator</span>
          </div>
          <button
            className="logout-button"
            title="Logout placeholder"
            onClick={() => alert("Session management is integrated with AWS IAM & Cognito.")}
            aria-label="Logout"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
