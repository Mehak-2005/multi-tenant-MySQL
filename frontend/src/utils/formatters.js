export function formatDate(dateString) {
  if (!dateString) return "—";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return dateString;
  }
}

export function formatRelativeTime(dateString) {
  if (!dateString) return "—";
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 10) return "just now";
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return dateString;
  }
}

export function formatDuration(startTime, endTime) {
  if (!startTime) return "—";
  try {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const diffMs = Math.max(0, end - start);
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  } catch {
    return "—";
  }
}

export function formatBytes(bytes) {
  if (bytes === 0 || bytes === "0") return "0 B";
  if (!bytes) return "—";
  const num = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (isNaN(num)) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return parseFloat((num / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function truncate(str, maxLen = 30) {
  if (!str) return "—";
  if (str.length <= maxLen) return str;
  return `${str.substring(0, maxLen)}...`;
}
