"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FileUp, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Bulk uploader (M9): pick a client, queue many files, upload them through the
 * existing single-file pipeline (/api/vault/upload) with a small concurrency
 * cap and per-file status. Nothing new server-side — the scan/vault path and
 * permissions are exactly the intake upload's.
 */

type ClientOption = { id: string; name: string };

type FileState = {
  id: string;
  name: string;
  size: number;
  status: "queued" | "uploading" | "scanning" | "clean" | "infected" | "scan_failed" | "error";
  detail?: string;
};

const CONCURRENCY = 3;

const STATUS_META: Record<FileState["status"], { label: string; variant: "default" | "accent" | "success" | "danger" | "warn" }> = {
  queued: { label: "Queued", variant: "default" },
  uploading: { label: "Uploading…", variant: "accent" },
  scanning: { label: "Scanning…", variant: "accent" },
  clean: { label: "In vault", variant: "success" },
  infected: { label: "Virus — quarantined", variant: "danger" },
  scan_failed: { label: "Scan failed", variant: "warn" },
  error: { label: "Failed", variant: "danger" },
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

let counter = 0;

export function BulkUploader({ clients }: { clients: ClientOption[] }) {
  const [clientId, setClientId] = useState("");
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Real File objects kept out of React state (not serialisable/needed for render).
  const blobs = useRef<Map<string, File>>(new Map());

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    const next: FileState[] = [];
    for (const f of incoming) {
      const id = `f${++counter}`;
      blobs.current.set(id, f);
      next.push({ id, name: f.name, size: f.size, status: "queued" });
    }
    setFiles((prev) => [...prev, ...next]);
  }

  function removeFile(id: string) {
    blobs.current.delete(id);
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function update(id: string, patch: Partial<FileState>) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  async function uploadOne(fs: FileState): Promise<void> {
    const file = blobs.current.get(fs.id);
    if (!file) return;
    update(fs.id, { status: "uploading", detail: undefined });
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("clientId", clientId);
      const res = await fetch("/api/vault/upload", { method: "POST", body: fd });
      const body = (await res.json()) as {
        error?: string;
        documentId?: string;
        status?: string;
        scanResult?: string;
      };
      if (!res.ok) {
        update(fs.id, { status: "error", detail: body.error ?? "Upload failed." });
        return;
      }
      let status = body.status ?? "pending_scan";
      let scanResult = body.scanResult;
      if (status === "pending_scan" && body.documentId) {
        update(fs.id, { status: "scanning" });
        for (let i = 0; i < 20 && status === "pending_scan"; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const poll = await fetch(`/api/vault/scan-status?id=${body.documentId}`).catch(() => null);
          if (!poll?.ok) break;
          const verdict = (await poll.json()) as { status: string; scanResult?: string };
          status = verdict.status;
          scanResult = verdict.scanResult;
        }
      }
      if (status === "clean") update(fs.id, { status: "clean" });
      else if (status === "infected") update(fs.id, { status: "infected", detail: scanResult });
      else if (status === "scan_failed") update(fs.id, { status: "scan_failed", detail: "Scanner unavailable — rescan from intake." });
      else update(fs.id, { status: "scanning", detail: "Still scanning — check the intake queue." });
    } catch {
      update(fs.id, { status: "error", detail: "Network error." });
    }
  }

  async function uploadAll() {
    if (!clientId) return;
    setBusy(true);
    // Snapshot the queued set, then run with a small concurrency cap.
    const queue = files.filter((f) => f.status === "queued" || f.status === "error");
    let idx = 0;
    async function worker() {
      while (idx < queue.length) {
        const item = queue[idx++];
        await uploadOne(item);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setBusy(false);
  }

  const queuedCount = files.filter((f) => f.status === "queued" || f.status === "error").length;
  const doneCount = files.filter((f) => ["clean", "infected", "scan_failed"].includes(f.status)).length;

  return (
    <div className="space-y-4" data-testid="bulk-uploader">
      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        aria-label="Client"
        data-testid="bulk-client"
        className="h-9 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none w-full max-w-sm"
      >
        <option value="">Choose a client…</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
        className={
          "rounded-lg border-2 border-dashed p-6 text-center transition " +
          (dragOver ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-slate-50")
        }
      >
        <Upload className="w-6 h-6 mx-auto text-slate-400" />
        <p className="text-sm text-slate-600 mt-2">Drag files here, or</p>
        <input
          ref={fileRef}
          type="file"
          multiple
          data-testid="bulk-files"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mt-1 text-sm text-indigo-600 hover:underline"
        >
          choose files
        </button>
      </div>

      {files.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
          {files.map((f) => {
            const meta = STATUS_META[f.status];
            return (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <FileUp className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-medium text-slate-800 truncate max-w-56" title={f.name}>
                  {f.name}
                </span>
                <span className="text-xs text-slate-400">{formatBytes(f.size)}</span>
                <span className="flex-1" />
                {f.detail && <span className="text-xs text-slate-500 truncate max-w-40">{f.detail}</span>}
                <Badge variant={meta.variant}>{meta.label}</Badge>
                {(f.status === "queued" || f.status === "error") && (
                  <button onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                    <X className="w-3.5 h-3.5 text-slate-400 hover:text-red-600" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          data-testid="bulk-upload"
          onClick={() => void uploadAll()}
          disabled={busy || !clientId || queuedCount === 0}
        >
          <FileUp /> {busy ? "Uploading…" : `Upload ${queuedCount} file${queuedCount === 1 ? "" : "s"}`}
        </Button>
        {doneCount > 0 && (
          <span className="text-xs text-slate-500">
            {doneCount} finished ·{" "}
            <Link href="/app/tax/intake" className="text-indigo-600 hover:underline">
              file them in the intake queue
            </Link>
          </span>
        )}
        {!clientId && files.length > 0 && (
          <span className="text-xs text-amber-600">Choose a client first.</span>
        )}
      </div>
    </div>
  );
}
