import { Inbox } from "lucide-react";

export default function EmptyState({
  icon: Icon = Inbox,
  title = "No data found",
  description = "There are no records matching your criteria.",
  actionLabel,
  onAction,
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon size={40} />
      </div>
      <h4 className="empty-state-title">{title}</h4>
      <p className="empty-state-desc">{description}</p>
      {actionLabel && onAction && (
        <button type="button" className="primary-button empty-state-btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
