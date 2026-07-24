"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, Search, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CATEGORY_META, TYPE_LABELS } from "@/lib/clients";
import type { StageCategory } from "@/db/schema";
import { distributeClients, type DistributeSummaryRow } from "./actions";

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

export type AccountantOption = { id: string; name: string };

const typeFilters = ["All", "Individual", "Corporation", "Trust"] as const;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA");
}

const col = createColumnHelper<ClientRow>();

export function ClientsTable({
  data,
  accountants = [],
  canDistribute = false,
}: {
  data: ClientRow[];
  accountants?: AccountantOption[];
  canDistribute?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof typeFilters)[number]>("All");
  const [showArchived, setShowArchived] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [modalOpen, setModalOpen] = useState(false);

  const selectable = canDistribute && accountants.length > 0;

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

  const columns = useMemo(() => {
    const base = [
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
    ];

    if (!selectable) return base;

    const select = col.display({
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          className="rounded"
          aria-label="Select all"
          checked={table.getIsAllRowsSelected()}
          ref={(el) => {
            if (el) el.indeterminate = table.getIsSomeRowsSelected();
          }}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="rounded"
          aria-label={`Select ${row.original.name}`}
          checked={row.getIsSelected()}
          onClick={(e) => e.stopPropagation()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    });
    return [select, ...base];
  }, [selectable]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: selectable,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  );

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

      {selectable && selectedIds.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 text-white text-sm">
          <span className="font-medium">
            {selectedIds.length} client{selectedIds.length === 1 ? "" : "s"} selected
          </span>
          <button
            onClick={() => setRowSelection({})}
            className="text-slate-300 hover:text-white text-xs underline underline-offset-2"
          >
            Clear
          </button>
          <div className="ml-auto">
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm font-medium"
            >
              <Users className="w-4 h-4" /> Distribute among accountants
            </button>
          </div>
        </div>
      )}

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

      {modalOpen && (
        <DistributeModal
          clientIds={selectedIds}
          accountants={accountants}
          onClose={() => setModalOpen(false)}
          onDone={() => {
            setModalOpen(false);
            setRowSelection({});
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function DistributeModal({
  clientIds,
  accountants,
  onClose,
  onDone,
}: {
  clientIds: string[];
  accountants: AccountantOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Default: distribute across everyone.
  const [chosen, setChosen] = useState<Set<string>>(new Set(accountants.map((a) => a.id)));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DistributeSummaryRow[] | null>(null);

  const chosenCount = chosen.size;
  const estBase = chosenCount > 0 ? Math.floor(clientIds.length / chosenCount) : 0;
  const estHigh = chosenCount > 0 && clientIds.length % chosenCount !== 0 ? estBase + 1 : estBase;

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = () => {
    setError(null);
    startTransition(async () => {
      const res = await distributeClients(clientIds, [...chosen]);
      if (res.error) setError(res.error);
      else setSummary(res.summary ?? []);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold">
            {summary ? "Clients distributed" : "Distribute clients"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {summary ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-slate-600">
              {clientIds.length} client{clientIds.length === 1 ? "" : "s"} shared out. New book sizes:
            </p>
            <ul className="space-y-1.5">
              {summary
                .slice()
                .sort((a, b) => b.total - a.total)
                .map((s) => (
                  <li key={s.accountantId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">{s.name}</span>
                    <span className="text-slate-500">
                      <span className="font-medium text-emerald-600">+{s.added}</span> · {s.total} total
                    </span>
                  </li>
                ))}
            </ul>
            <div className="pt-1 flex justify-end">
              <Button onClick={onDone}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-slate-600">
              Share <span className="font-medium text-slate-800">{clientIds.length}</span> selected
              client{clientIds.length === 1 ? "" : "s"} across the accountants you choose. Households
              stay together, and each accountant’s current workload is taken into account.
            </p>

            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {accountants.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={chosen.has(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                  <span className="text-sm text-slate-700">{a.name}</span>
                </label>
              ))}
            </div>

            {chosenCount > 0 && (
              <p className="text-xs text-slate-500">
                Roughly {estBase === estHigh ? estBase : `${estBase}–${estHigh}`} new client
                {estHigh === 1 ? "" : "s"} each (before workload balancing).
              </p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={run} disabled={pending || chosenCount === 0}>
                {pending ? "Distributing…" : `Distribute to ${chosenCount}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
