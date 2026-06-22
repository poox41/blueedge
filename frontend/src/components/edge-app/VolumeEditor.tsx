import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VolumeForm } from "./container-model";
import { formId } from "./container-model";

export function VolumeEditor({ values, onChange }: { values: VolumeForm[]; onChange: (values: VolumeForm[]) => void }) {
  const add = () => onChange([...values, { id: formId("volume"), name: "", type: "emptyDir", sourceName: "", hostPath: "", hostPathType: "", medium: "", sizeLimit: "" }]);
  const patch = (id: string, changes: Partial<VolumeForm>) => onChange(values.map((item) => item.id === id ? { ...item, ...changes } : item));
  return <div className="rounded-lg border border-[#C9CDD4] bg-white p-4 space-y-3">
    <div className="flex items-center justify-between"><div><div className="font-medium text-sm">数据卷 Volumes <span className="ml-2 rounded border border-[#C9CDD4] bg-[#F7F8FA] px-1.5 py-0.5 text-[10px] font-normal text-[#86909C]">选填</span></div><p className="mt-1 text-xs text-[#86909C]">先定义卷，再在工作容器或初始化容器中按名称挂载。</p></div><Button type="button" variant="outline" size="sm" onClick={add}><Plus className="mr-1 h-3.5 w-3.5"/>添加数据卷</Button></div>
    {values.map((item) => <div key={item.id} className="grid grid-cols-2 gap-3 rounded-md border border-[#E5E6EB] bg-[#F7F8FA] p-3">
      <Input className="h-8 bg-white text-xs" value={item.name} placeholder="Volume 名称" onChange={(e) => patch(item.id, { name: e.target.value })}/>
      <Select value={item.type} onValueChange={(type: VolumeForm["type"]) => patch(item.id, { type })}><SelectTrigger className="h-8 bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="persistentVolumeClaim">PVC</SelectItem><SelectItem value="configMap">ConfigMap</SelectItem><SelectItem value="secret">Secret</SelectItem><SelectItem value="hostPath">HostPath</SelectItem><SelectItem value="emptyDir">EmptyDir</SelectItem></SelectContent></Select>
      {(item.type === "persistentVolumeClaim" || item.type === "configMap" || item.type === "secret") && <Input className="h-8 bg-white text-xs" value={item.sourceName} placeholder={item.type === "persistentVolumeClaim" ? "PVC 名称" : item.type === "configMap" ? "ConfigMap 名称" : "Secret 名称"} onChange={(e) => patch(item.id, { sourceName: e.target.value })}/>} 
      {item.type === "hostPath" && <><Input className="h-8 bg-white text-xs" value={item.hostPath} placeholder="主机路径" onChange={(e) => patch(item.id, { hostPath: e.target.value })}/><Input className="h-8 bg-white text-xs" value={item.hostPathType} placeholder="类型，如 DirectoryOrCreate" onChange={(e) => patch(item.id, { hostPathType: e.target.value })}/></>}
      {item.type === "emptyDir" && <><Select value={item.medium || "disk"} onValueChange={(medium) => patch(item.id, { medium: medium === "disk" ? "" : "Memory" })}><SelectTrigger className="h-8 bg-white text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="disk">节点临时磁盘</SelectItem><SelectItem value="Memory">内存</SelectItem></SelectContent></Select><Input className="h-8 bg-white text-xs" value={item.sizeLimit} placeholder="容量限制，如 1Gi（可选）" onChange={(e) => patch(item.id, { sizeLimit: e.target.value })}/></>}
      <Button type="button" variant="ghost" size="sm" className="col-span-2 justify-self-end text-[#F53F3F]" onClick={() => onChange(values.filter((value) => value.id !== item.id))}><Trash2 className="mr-1 h-3.5 w-3.5"/>删除</Button>
    </div>)}
  </div>;
}
