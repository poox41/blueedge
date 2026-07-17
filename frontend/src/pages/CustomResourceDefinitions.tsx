import { ListPagination } from "@/components/common/ListPagination";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, RefreshCw, Eye, Copy } from "lucide-react";
import { getCRD, listCRDs } from "@/api/services/resources";
import { cn } from "@/lib/utils";

interface CRD { name: string; group: string; type: string; scope: string; createdAt: string; versions?: string[]; plural?: string; singular?: string; raw?: any; }

function toCRD(item: any): CRD {
  const name = item?.metadata?.name || item?.name || "-";
  const versions = Array.isArray(item?.spec?.versions)
    ? item.spec.versions.map((version: any) => version.name).filter(Boolean)
    : item?.version
      ? [item.version]
      : ["v1"];
  return {
    name,
    group: item?.spec?.group || item?.group || "-",
    type: item?.spec?.names?.kind || item?.type || "-",
    scope: item?.spec?.scope || item?.scope || "-",
    createdAt: item?.metadata?.creationTimestamp || item?.createdAt || "-",
    versions,
    plural: item?.spec?.names?.plural || item?.plural || "-",
    singular: item?.spec?.names?.singular || item?.singular || "-",
    raw: item,
  };
}

function yaml(n: CRD) {
  return `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${n.name}
spec:
  group: ${n.group}
  names:
    kind: ${n.type}
  scope: ${n.scope}
  versions:
    - name: v1
      served: true
      storage: true`;
}

export function CustomResourceDefinitions() {
  const [data, setData] = useState<CRD[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<CRD | null>(null);
  const [pageSize, setPageSize] = useState(10);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const rows = await listCRDs();
      setData(rows.map(toCRD));
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CRD 数据加载失败");
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => { let r = data; if (search.trim()) r = r.filter(d => d.name.toLowerCase().includes(search.toLowerCase())); return r; }, [data, search]);
  const start = (page - 1) * pageSize;
  const paginated = filtered.slice(start, start + pageSize);

  const openDetail = async (d: CRD) => {
    setSelected(d);
    setDetailOpen(true);
    try {
      setSelected(toCRD(await getCRD(d.name)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "CRD 详情加载失败");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">自定义资源定义</h1>
        <Button variant="outline" size="sm" className="h-8 px-3 text-sm" onClick={loadData} disabled={isLoading}><RefreshCw className={cn("w-3.5 h-3.5 mr-1", isLoading && "animate-spin")} />刷新</Button>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="toolbar-search relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" /><Input placeholder="请输入名称搜索" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 h-9 text-sm bg-white" /></div>
        <span className="text-sm text-[var(--color-text-tertiary)]">共 {filtered.length} 条</span>
      </div>
      {error && <div className="rounded-md border border-[#F77234]/20 bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[#D25F00]">{error}</div>}
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
        <Table><TableHeader><TableRow className="bg-[var(--color-bg-soft)] hover:bg-[var(--color-bg-soft)]">
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">名称</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">组</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">类型</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">范围</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">版本</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4">创建时间</TableHead>
          <TableHead className="text-sm font-medium text-[var(--color-text-primary)] h-10 px-4 w-[100px]">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>{isLoading ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">正在加载自定义资源定义数据...</TableCell></TableRow>) : paginated.length === 0 ? (<TableRow><TableCell colSpan={7} className="text-center py-16 text-[var(--color-text-tertiary)] text-sm">暂无自定义资源定义数据</TableCell></TableRow>) : paginated.map(row => (
          <TableRow key={row.name} className="hover:bg-[var(--color-bg-soft)] transition-colors border-b border-[var(--color-border)]">
            <TableCell className="text-sm text-[var(--color-brand)] font-medium px-4 py-3 cursor-pointer hover:underline" onClick={() => openDetail(row)}>{row.name}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.group}</TableCell>
            <TableCell className="text-sm text-[var(--color-text-secondary)] px-4 py-3">{row.type}</TableCell>
            <TableCell className="px-4 py-3"><Badge variant="outline" className="text-xs font-normal">{row.scope}</Badge></TableCell>
            <TableCell className="px-4 py-3"><div className="flex flex-wrap gap-1">{(row.versions || []).map(v => (<Badge key={v} variant="secondary" className="text-xs font-normal bg-[var(--color-brand-light)] text-[var(--color-brand)]">{v}</Badge>))}</div></TableCell>
            <TableCell className="text-sm text-[var(--color-text-tertiary)] px-4 py-3">{row.createdAt}</TableCell>
            <TableCell className="px-4 py-3"><button type="button" className="action-button" title="查看详情" onClick={() => openDetail(row)}><Eye className="h-3.5 w-3.5" /></button></TableCell>
          </TableRow>
        ))}</TableBody></Table>
        <ListPagination total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />
      </div>
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-[var(--color-border-strong)]"><SheetTitle className="text-base font-semibold">{selected?.name}</SheetTitle></SheetHeader>
          {selected && (<Tabs defaultValue="overview" className="mt-4"><TabsList className="bg-[var(--color-bg-soft)] h-9"><TabsTrigger value="overview" className="text-xs h-7">概览</TabsTrigger><TabsTrigger value="yaml" className="text-xs h-7">YAML</TabsTrigger></TabsList>
            <TabsContent value="overview" className="mt-3 space-y-4">
              <div className="grid grid-cols-2 gap-3"><Info label="名称" value={selected.name} /><Info label="组" value={selected.group} /><Info label="类型" value={selected.type} /><Info label="复数名" value={selected.plural || "-"} /><Info label="单数名" value={selected.singular || "-"} /><Info label="范围" value={selected.scope} /><Info label="版本" value={(selected.versions || []).join(", ")} /></div>
            </TabsContent>
            <TabsContent value="yaml" className="mt-3"><div className="relative"><pre className="blueedge-code-block p-4 overflow-x-auto">{yaml(selected)}</pre><Button variant="ghost" size="sm" className="absolute top-2 right-2 text-white/60 hover:text-white h-6" onClick={() => navigator.clipboard.writeText(yaml(selected))}><Copy className="w-3.5 h-3.5" /></Button></div></TabsContent>
          </Tabs>)}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (<div className="blueedge-info-card"><p className="blueedge-info-card-label">{label}</p><p className="blueedge-info-card-value">{value}</p></div>);
}
