import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { SkeletonTable } from "./Skeleton";
import EmptyState from "./EmptyState";

export default function SafeTable({
  columns = [],
  data = [],
  isLoading = false,
  emptyTitle = "No records found",
  emptyDesc = "There are no records to display.",
  searchPlaceholder = "Search...",
  searchKey,
  pageSize = 10,
  rowKey = (row, i) => row.id || row.tenant_id || row.job_id || row.host_id || i,
  onRowClick,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc"); // 'asc' | 'desc'
  const [page, setPage] = useState(1);

  // Search Filtering
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const term = searchTerm.toLowerCase().trim();
    return data.filter((row) => {
      if (searchKey && row[searchKey]) {
        return String(row[searchKey]).toLowerCase().includes(term);
      }
      return Object.values(row).some((val) =>
        String(val ?? "").toLowerCase().includes(term)
      );
    });
  }, [data, searchTerm, searchKey]);

  // Sorting
  const sortedData = useMemo(() => {
    if (!sortCol) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      return sortDir === "asc"
        ? strA.localeCompare(strB)
        : strB.localeCompare(strA);
    });
  }, [filteredData, sortCol, sortDir]);

  // Pagination
  const totalPages = Math.ceil(sortedData.length / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const handleSort = (key) => {
    if (!key) return;
    if (sortCol === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="safe-table-container">
      {/* Search Bar if enabled */}
      {searchPlaceholder && (
        <div className="table-controls">
          <div className="search-input-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder={searchPlaceholder}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="table-total-count">
            Showing {filteredData.length} {filteredData.length === 1 ? "result" : "results"}
          </div>
        </div>
      )}

      {/* Table Content */}
      <div className="table-responsive">
        {isLoading ? (
          <SkeletonTable rows={pageSize} cols={columns.length} />
        ) : paginatedData.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDesc} />
        ) : (
          <table className="safe-table">
            <thead>
              <tr>
                {columns.map((col, index) => {
                  const isSorted = sortCol === col.key;
                  return (
                    <th
                      key={col.key || index}
                      className={col.sortable ? "sortable-th" : ""}
                      onClick={() => col.sortable && handleSort(col.key)}
                      style={{ width: col.width }}
                    >
                      <div className="th-content">
                        <span>{col.label}</span>
                        {col.sortable && (
                          <span className="sort-icon">
                            {isSorted && sortDir === "asc" ? (
                              <ChevronUp size={14} />
                            ) : isSorted && sortDir === "desc" ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronDown size={14} className="sort-inactive" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((row, rIdx) => (
                <tr
                  key={rowKey(row, rIdx)}
                  onClick={() => onRowClick && onRowClick(row)}
                  className={onRowClick ? "clickable-row" : ""}
                >
                  {columns.map((col, cIdx) => (
                    <td key={col.key || cIdx}>
                      {col.render
                        ? col.render(row[col.key], row, rIdx)
                        : (row[col.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      {!isLoading && totalPages > 1 && (
        <div className="pagination-footer">
          <div className="pagination-info">
            Page {currentPage} of {totalPages}
          </div>
          <div className="pagination-buttons">
            <button
              className="pagination-btn"
              disabled={currentPage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous Page"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <button
              className="pagination-btn"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next Page"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
