export function Skeleton({ className = "", width, height, circle = false }) {
  const style = {};
  if (width) style.width = width;
  if (height) style.height = height;
  if (circle) style.borderRadius = "50%";

  return <div className={`skeleton-loader ${className}`} style={style} />;
}

export function SkeletonCard({ count = 1 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="dashboard-card skeleton-card">
          <div className="skeleton-card-header">
            <Skeleton width="40%" height="16px" />
            <Skeleton width="32px" height="32px" circle />
          </div>
          <Skeleton width="60%" height="28px" className="mt-2" />
          <Skeleton width="30%" height="14px" className="mt-2" />
        </div>
      ))}
    </>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-header">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} height="18px" width="70%" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-table-row">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height="16px" width={c === 0 ? "50%" : "85%"} />
          ))}
        </div>
      ))}
    </div>
  );
}
