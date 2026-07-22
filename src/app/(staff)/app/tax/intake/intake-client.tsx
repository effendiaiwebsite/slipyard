"use client";

import { Download, FileUp, RotateCw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DOC_STATUS_META, formatBytes } from "@/lib/document-meta";
import {
  assignDocument,
  deleteDocument,
  getDownloadUrl,
  rescanDocument,
} from "../../documents/actions";

/**
 * Intake queue (M3): the vault's front door. Clerks (and everyone else)
 * upload here against a client; documents wait in the queue until someone
 * with documents.manage files them against an engagement — optionally
 * satisfying a checklist item, which can auto-advance the return.
 */

export type IntakeDoc = {
  id: string;
  filename: string;
  status: "pending_scan" | "clean" | "infected" | "scan_failed";
  sizeBytes: number;
  createdAt: string;
  clientId: string;
  clientName: string;
  uploaderName: string | null;
  scanResult: string | null;
};

export type ClientOption = { id: string; name: string };
export type EngagementOption = { id: string; clientId: string; label: string };
export type MissingItemOption = { id: string; engagementId: string; title: string };

const selectCls =
  "h-8 px-2 text-xs rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none max-w-56";

export function IntakeUploadForm({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file || !clientId) {
      setMsg("Pick a client and a file first.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("clientId", clientId);
      const res = await fetch("/api/vault/upload", { method: "POST", body: fd });
      const body = (await res.json()) as { error?: string; status?: string; scanResult?: string };
      if (!res.ok) {
        setMsg(body.error ?? "Upload failed.");
      } else if (body.status === "infected") {
        setMsg(`Virus detected (${body.scanResult}) — the file was quarantined.`);
      } else if (body.status === "scan_failed") {
        setMsg("Uploaded, but the scanner was unavailable — retry from the queue.");
      } else {
        setMsg("Received and scanned clean — it's in the queue below.");
        if (fileRef.current) fileRef.current.value = "";
      }
      router.refresh();
    } catch {
      setMsg("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className={selectCls}
          aria-label="Client"
        >
          <option value="">Choose a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          className="text-xs file:mr-2 file:h-8 file:px-3 file:rounded-md file:border-0 file:bg-slate-900 file:text-white file:text-xs file:cursor-pointer text-slate-500"
        />
        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          <FileUp /> {busy ? "Scanning…" : "Upload to intake"}
        </Button>
        <span className="text-[11px] text-slate-400">PDF, images, Office, CSV · max 25 MB</span>
      </div>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}

export function IntakeQueue({
  docs,
  engagements,
  missingItems,
  canManage,
}: {
  docs: IntakeDoc[];
  engagements: EngagementOption[];
  missingItems: MissingItemOption[];
  canManage: boolean;
}) {
  if (docs.length === 0) {
    return <p className="text-sm text-slate-400">The intake queue is empty. Nice.</p>;
  }
  return (
    <ul className="divide-y divide-[var(--color-border)]">
      {docs.map((d) => (
        <IntakeRow
          key={d.id}
          doc={d}
          engagements={engagements.filter((e) => e.clientId === d.clientId)}
          missingItems={missingItems}
          canManage={canManage}
        />
      ))}
    </ul>
  );
}

function IntakeRow({
  doc,
  engagements,
  missingItems,
  canManage,
}: {
  doc: IntakeDoc;
  engagements: EngagementOption[];
  missingItems: MissingItemOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [engagementId, setEngagementId] = useState("");
  const [itemId, setItemId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const meta = DOC_STATUS_META[doc.status];
  const items = missingItems.filter((i) => i.engagementId === engagementId);

  const run = (fn: () => Promise<{ error?: string; autoAdvancedTo?: string; url?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.url) window.open(res.url, "_blank", "noopener");
      setMsg(res.error ?? (res.autoAdvancedTo ? `Return moved to “${res.autoAdvancedTo}”.` : null));
      router.refresh();
    });

  return (
    <li className="py-2.5 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="font-medium text-slate-800 truncate max-w-56" title={doc.filename}>
          {doc.filename}
        </span>
        <Badge variant={meta.badge}>{meta.label}</Badge>
        {doc.status === "infected" && doc.scanResult && (
          <span className="text-[11px] text-red-600 font-mono">{doc.scanResult}</span>
        )}
        <span className="text-xs text-slate-500">
          {doc.clientName} · {formatBytes(doc.sizeBytes)} ·{" "}
          {new Date(doc.createdAt).toLocaleDateString("en-CA")}
          {doc.uploaderName ? ` · by ${doc.uploaderName}` : ""}
        </span>
        <span className="flex-1" />
        {doc.status === "clean" && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => getDownloadUrl(doc.id))}>
            <Download />
          </Button>
        )}
        {doc.status === "scan_failed" && canManage && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => rescanDocument(doc.id))}>
            <RotateCw /> Rescan
          </Button>
        )}
        {(doc.status === "infected" || doc.status === "scan_failed") && canManage && (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => deleteDocument(doc.id))}>
            <Trash2 /> Remove
          </Button>
        )}
      </div>

      {doc.status === "clean" && canManage && (
        <div className="flex items-center gap-2 flex-wrap">
          {engagements.length > 0 ? (
            <>
              <select
                value={engagementId}
                onChange={(e) => {
                  setEngagementId(e.target.value);
                  setItemId("");
                }}
                className={selectCls}
                aria-label="Engagement"
              >
                <option value="">File against engagement…</option>
                {engagements.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
              {engagementId && items.length > 0 && (
                <select
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                  className={selectCls}
                  aria-label="Checklist item"
                >
                  <option value="">No checklist item</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title}
                    </option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                disabled={pending || !engagementId}
                onClick={() => run(() => assignDocument(doc.id, engagementId, itemId || undefined))}
              >
                File it
              </Button>
            </>
          ) : (
            <span className="text-xs text-slate-400">
              No engagements for this client yet — create one from their page.
            </span>
          )}
        </div>
      )}
      {msg && (
        <p className="text-xs text-slate-600 flex items-center gap-1">
          {msg}
          <button onClick={() => setMsg(null)} aria-label="Dismiss">
            <X className="w-3 h-3" />
          </button>
        </p>
      )}
    </li>
  );
}
