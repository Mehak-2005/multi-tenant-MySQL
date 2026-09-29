import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger", // 'danger' | 'primary'
  isLoading = false,
  onConfirm,
  onClose,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={isLoading ? undefined : onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <button
          className="modal-close-btn"
          onClick={onClose}
          disabled={isLoading}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        <div className="modal-header">
          <div className={`modal-icon modal-icon-${variant}`}>
            <AlertTriangle size={24} />
          </div>
          <div>
            <h3 id="modal-title" className="modal-title">
              {title}
            </h3>
          </div>
        </div>

        <div className="modal-body">
          <p className="modal-message">{message}</p>
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={variant === "danger" ? "danger-button" : "primary-button"}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
