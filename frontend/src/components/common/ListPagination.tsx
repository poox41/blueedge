import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZES = [10, 20, 50];

export interface ListPaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
}

export function ListPagination({ total, page, pageSize, onPageChange, onPageSizeChange, className }: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) onPageChange(totalPages);
  }, [onPageChange, page, totalPages]);

  return (
    <div
      className={cn(
        "flex min-h-16 items-center justify-between border-t border-[#e5e7eb] bg-white px-5",
        className,
      )}
    >
      <span className="text-sm text-[#9ca3af]">共 {total} 项</span>
      <div className="flex items-center gap-3 text-sm text-[#9ca3af]">
        <button
          type="button"
          title="上一页"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-9 min-w-10 items-center justify-center rounded-md border border-[#d7dde7] bg-[#f8fafc] px-2 text-[#6b7280]">{page}</span>
          <span>/ {totalPages}</span>
        </div>
        <button
          type="button"
          title="下一页"
          aria-label="下一页"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        <select
          aria-label="每页条数"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-10 min-w-24 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm text-[#6b7280] outline-none focus:border-[#1a73e8]"
        >
          {DEFAULT_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 项</option>)}
        </select>
      </div>
    </div>
  );
}

export function useListPagination<T>(items: T[], initialPageSize = 10) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const setPageSize = (nextPageSize: number) => {
    setPageSizeState(nextPageSize);
    setPage(1);
  };

  return {
    paginatedItems,
    paginationProps: {
      total: items.length,
      page,
      pageSize,
      onPageChange: setPage,
      onPageSizeChange: setPageSize,
    },
  };
}
