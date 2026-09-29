import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type, message, duration = 4500) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, type, message }]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  const success = useCallback((msg, duration) => addToast("success", msg, duration), [addToast]);
  const error = useCallback((msg, duration) => addToast("error", msg, duration), [addToast]);
  const warning = useCallback((msg, duration) => addToast("warning", msg, duration), [addToast]);
  const info = useCallback((msg, duration) => addToast("info", msg, duration), [addToast]);

  const contextValue = useMemo(
    () => ({ success, error, warning, info, addToast, removeToast }),
    [success, error, warning, info, addToast, removeToast]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => {
          let Icon = Info;
          let toastClass = "toast-info";
          if (t.type === "success") {
            Icon = CheckCircle2;
            toastClass = "toast-success";
          } else if (t.type === "error") {
            Icon = AlertCircle;
            toastClass = "toast-error";
          } else if (t.type === "warning") {
            Icon = AlertTriangle;
            toastClass = "toast-warning";
          }

          return (
            <div key={t.id} className={`toast-item ${toastClass}`}>
              <Icon size={20} className="toast-icon" />
              <div className="toast-message">{t.message}</div>
              <button
                className="toast-close"
                onClick={() => removeToast(t.id)}
                aria-label="Close notification"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
