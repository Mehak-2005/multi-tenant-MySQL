import { useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-container">
      <Sidebar
        isOpen={sidebarOpen}
        isMobileOpen={mobileOpen}
        onToggleCollapse={() => setSidebarOpen((prev) => !prev)}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className={`main-layout ${sidebarOpen ? "main-layout-expanded" : "main-layout-collapsed"}`}>
        <Topbar onToggleMobile={() => setMobileOpen((prev) => !prev)} />
        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
