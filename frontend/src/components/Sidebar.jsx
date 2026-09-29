import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  BriefcaseBusiness,
  Server,
  DatabaseBackup,
  RotateCcw,
  Activity,
  Settings,
  PlusCircle,
  Database,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

export default function Sidebar({
  isOpen,
  isMobileOpen,
  onToggleCollapse,
  onCloseMobile,
}) {
  const menuItems = [
    {
      name: "Dashboard",
      path: "/dashboard",
      icon: LayoutDashboard,
    },
    {
      name: "Tenants",
      path: "/tenants",
      icon: Users,
    },
    {
      name: "Jobs",
      path: "/jobs",
      icon: BriefcaseBusiness,
    },
    {
      name: "Hosts",
      path: "/hosts",
      icon: Server,
    },
    {
      name: "Backups",
      path: "/backups",
      icon: DatabaseBackup,
    },
    {
      name: "Restore",
      path: "/restore",
      icon: RotateCcw,
    },
    {
      name: "System Health",
      path: "/health",
      icon: Activity,
    },
    {
      name: "Settings",
      path: "/settings",
      icon: Settings,
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div className="sidebar-mobile-backdrop" onClick={onCloseMobile} />
      )}

      <aside
        className={`sidebar ${isOpen ? "sidebar-expanded" : "sidebar-collapsed"} ${
          isMobileOpen ? "sidebar-mobile-open" : ""
        }`}
      >
        {/* Brand Header */}
        <div className="sidebar-header">
          <div className="brand-wrapper">
            <div className="brand-logo">
              <Database size={22} className="brand-icon" />
            </div>
            {isOpen && (
              <div className="brand-text">
                <span className="brand-title">MySQL Fleet</span>
                <span className="brand-subtitle">AWS Serverless</span>
              </div>
            )}
          </div>

          {/* Close button for mobile */}
          <button
            className="mobile-close-btn"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Quick Action: Provision Tenant */}
        <div className="sidebar-action-container">
          <NavLink
            to="/provision"
            className={({ isActive }) =>
              `provision-nav-btn ${isActive ? "active" : ""}`
            }
            onClick={onCloseMobile}
          >
            <PlusCircle size={18} />
            {isOpen && <span>Provision Tenant</span>}
          </NavLink>
        </div>

        {/* Navigation Menu */}
        <nav className="sidebar-nav">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={onCloseMobile}
                title={!isOpen ? item.name : undefined}
              >
                <Icon size={19} className="nav-icon" />
                {isOpen && <span className="nav-label">{item.name}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Collapse Toggle Footer (Desktop only) */}
        <div className="sidebar-footer">
          <button
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            {isOpen && <span>Collapse Sidebar</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
