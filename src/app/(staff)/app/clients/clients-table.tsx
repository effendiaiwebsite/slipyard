"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { CATEGORY_META, TYPE_LABELS } from "@/lib/clients";
import type { StageCategory } from "@/db/schema";

export type ClientRow = {
  id: string;
  name: string;
  type: "individual" | "corporation" | "trust";
  status: "active" | "archived";
  sinMasked: string | null;
  stageLabel: string | null;
  stageCategory: StageCategory | null;
  engagementLabel: string | null;
  owner: string | null;
  household: string | null;
  lastContact: string | null; // ISO
  tags: string[];
  city: string | null;
};

const typeFilters = ["All", "Individual", "Corporation", "Trust"] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA");
}

const col = createColumnHelper<ClientRow>();

export function ClientsTable({ data }: { data: ClientRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof typeFilters)[number]>("All");
  const [showArchived, setShowArchived] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

  const filtered = useMemo(
    () =>
      data.filter((r) => {
        if (!showArchived && r.status === "archived") return false;
        if (typeFilter !== "All" && TYPE_LABELS[r.type] !== typeFilter) return false;
        if (q) {
          const needle = q.toLowerCase();
          const hay = [r.name, r.city ?? "", r.owner ?? "", r.household ?? "", ...r.tags]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      }),
    [data, q, typeFilter, showArchived]
  );

  const columns = useMemo(
    () => [
      col.accessor("name", {
        header: "Client",
        cell: (info) => (
          <div>
            <span className="font-medium">{info.getValue()}</span>
            {info.row.original.status === "archived" && (
              <Badge className="ml-2" variant="default">
                Archived
              </Badge>
            )}
            {info.row.original.household && (
              <div className="text-xs text-slate-400">{info.row.original.household}</div>
            )}
          </div>
        ),
      }),
      col.accessor("type", {
        header: "Type",
        cell: (info) => <Badge variant="accent">{TYPE_LABELS[info.getValue()]}</Badge>,
      }),
      col.accessor("engagementLabel", {
        header: "Return",
        cell: (info) => (
          <span className="font-mono text-xs text-slate-600">{info.getValue() ?? "—"}</span>
        ),
      }),
      col.accessor("stageLabel", {
        header: "Stage",
        cell: (info) => {
          const label = info.getValue();
          const category = info.row.original.stageCategory;
          if (!label || !category) return <span className="text-slate-300 text-xs">—</span>;
          return <Badge variant={CATEGORY_META[category].badge}>{label}</Badge>;
        },
      }),
      col.accessor("owner", {
        header: "Owner",
        cell: (info) => (
          <span className="text-slate-600">{info.getValue() ?? <span className="text-slate-300">Unassigned</span>}</span>
        ),
      }),
      col.accessor("lastContact", {
        header: "Last contact",
        cell: (info) => <span className="text-slate-500 text-xs">{fmtDate(info.getValue())}</span>,
      }),
      col.accessor("tags", {
        header: "Tags",
        enableSorting: false,
        cell: (info) => (
          <div className="flex gap-1 flex-wrap">
            {info.getValue().map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]"
              >
                {t}
              </span>
            ))}
          </div>
        ),
      }),
    ],
    []
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 flex-1 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, tag, city, owner…"
              className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            {typeFilters.map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                  typeFilter === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded"
            />
            Show archived
          </label>
        </div>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 uppercase tracking-wide bg-slate-50/60">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-[var(--color-border)]">
                {hg.headers.map((h) => (
                  <th key={h.id} className="text-left font-medium px-4 py-2.5">
                    {h.column.getCanSort() ? (
                      <button
                        className="inline-flex items-center gap-1 hover:text-slate-700"
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => router.push(`/app/clients/${row.original.id}`)}
                className="border-b border-[var(--color-border)] last:border-0 hover:bg-slate-50 cursor-pointer"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-slate-400">
                  No clients match. Clear the search or add your first client.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
