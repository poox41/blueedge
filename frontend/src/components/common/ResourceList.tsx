import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { Search, FileText, Trash2, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Column {
  key: string;
  title: string;
  width?: string;
  render?: (row: any) => React.ReactNode;
}

interface ResourceListProps {
  title: string;
  columns: Column[];
  data: any[];
  rowKey: string;
  searchFields?: string[];
  addLabel?: string;
  onAdd?: () => void;
  namespace?: string;
  onNamespaceChange?: (value: string) => void;
  emptyText?: string;
}

export function ResourceList({
  title,
  columns,
  data,
  rowKey,
  searchFields = ["name"],
  addLabel = "添加",
  onAdd,
  emptyText = "暂无数据",
}: ResourceListProps) {
  const [searchValue, setSearchValue] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const filteredData = data.filter((row) => {
    if (!searchValue) return true;
    return searchFields.some((field) =>
      String(row[field] || "").toLowerCase().includes(searchValue.toLowerCase())
    );
  });

  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
  const start = (currentPage - 1) * pageSize;
  const paginatedData = filteredData.slice(start, start + pageSize);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1D2129]">{title}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-sm border-[#C9CDD4] text-[#4E5969] hover:border-[#165DFF] hover:text-[#165DFF]"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            刷新
          </Button>
          {onAdd && (
            <Button
              size="sm"
              onClick={onAdd}
              className="h-8 px-3 text-sm bg-[#165DFF] hover:bg-[#165DFF]/90 text-white"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {addLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9CDD4]" />
          <Input
            placeholder="请输入名称搜索"
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9 h-9 text-sm border-[#C9CDD4] focus-visible:ring-[#165DFF] bg-white"
          />
        </div>
        <span className="text-sm text-[#86909C]">
          共 {filteredData.length} 条
        </span>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E6EB] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F7F8FA] hover:bg-[#F7F8FA]">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className="text-sm font-medium text-[#1D2129] h-10 px-4"
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.title}
                </TableHead>
              ))}
              <TableHead className="text-sm font-medium text-[#1D2129] h-10 px-4 w-[120px]">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  className="text-center py-16 text-[#86909C] text-sm"
                >
                  {emptyText}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => (
                <TableRow
                  key={String(row[rowKey]) + index}
                  className="hover:bg-[#F7F8FA] transition-colors border-b border-[#F2F3F5]"
                >
                  {columns.map((col) => (
                    <TableCell key={col.key} className="text-sm text-[#4E5969] px-4 py-3">
                      {col.render ? col.render(row) : row[col.key]}
                    </TableCell>
                  ))}
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-[#165DFF] hover:text-[#165DFF] hover:bg-[#E8F3FF]"
                      >
                        <FileText className="w-3.5 h-3.5 mr-1" />
                        YAML
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-[#F53F3F] hover:text-[#F53F3F] hover:bg-[#FFECE8]"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {filteredData.length > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#86909C]">
            显示 {start + 1}-{Math.min(start + pageSize, filteredData.length)}，共 {filteredData.length} 条
          </span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="h-7 w-7 p-0 border-[#C9CDD4]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <PaginationItem key={page}>
                  <Button
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      "h-7 w-7 p-0 text-xs",
                      currentPage === page
                        ? "bg-[#165DFF] text-white hover:bg-[#165DFF]/90"
                        : "border-[#C9CDD4] text-[#4E5969]"
                    )}
                  >
                    {page}
                  </Button>
                </PaginationItem>
              ))}
              <PaginationItem>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="h-7 w-7 p-0 border-[#C9CDD4]"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
