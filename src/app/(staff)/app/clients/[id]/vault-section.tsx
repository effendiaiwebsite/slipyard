"use client";

import { Download, FileUp, ListChecks, RotateCw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHECKLIST_STATUS_META, DOC_STATUS_META, formatBytes } from "@/lib/document-meta";
import {
  addChecklistItem,
  assignDocument,
  deleteDocument,
  generateChecklist,
  getDownloadUrl,
  removeChecklistItem,
  rescanDocument,
  setChecklistItemStatus,
} from "../../documents/actions";

/**
 * Client-detail vault UI (M3): the Documents card and the per-engagement
 * checklist. Uploads POST multipart to /api/vault/upload (quarantine →
 * scan → vault happens before the response), then refresh.
 */

type ActionResult = { error?: string; ok?: boolean; autoAdvancedTo?: string; url?: string } | null;

export type DocRow = {
  id: string;
  filename: string;
  status: "pending_scan" | "clean" | "infected" | "scan_failed";
  sizeBytes: number;
  createdAt: string;
  uploaderName: string | null;
  /** M4: portal uploads carry a badge so staff see the client sent it. */
  source: "staff_upload" | "portal_upload";
  engagementId: string | null;
  engagementLabel: string | null;
  scanResult: string | null;
};

export type EngagementOption = { id: string; label: string };

export type ChecklistItemRow = {
  id: string;
  title: string;
  required: boolean;
  status: "missing" | "received" | "waived";
  documentName: string | null;
};

const selectCls =
  "h-8 px-2 text-xs rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

/** Shared uploader: posts the file, reports scan outcome, refreshes. */
function useUpload(onDone?: (msg: string | null) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(fields: Record<string, string>, file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      for (const [k, v] of Object.entries(fields)) if (v) fd.set(k, v);
      const res = await fetch("/api/vault/upload", { method: "POST", body: fd });
      const body = (await res.json()) as {
        error?: string;
        status?: string;
        scanResult?: string;
        autoAdvancedTo?: string | null;
      };
      if (!res.ok) {
        setError(body.error ?? "Upload failed.");
        return;
      }
      let message: string | null = null;
      if (body.status === "infected") {
        message = `Virus detected (${body.scanResult}) — the file was quarantined, not stored in the vault.`;
      } else if (body.status === "scan_failed") {
        message = "Uploaded, but the virus scanner was unavailable. Retry the scan from the list below.";
      } else if (body.autoAdvancedTo) {
        message = `Received — engagement moved to “${body.autoAdvancedTo}”.`;
      }
      onDone?.(message);
      router.refresh();
    } catch {
      setError("Upload failed — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return { upload, busy, error, setError };
}

export function DocumentsCard({
  clientId,
  docs,
  engagements,
  canUpload,
  canManage,
}: {
  clientId: string;
  docs: DocRow[];
  engagements: EngagementOption[];
  canUpload: boolean;
  canManage: boolean;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const { upload, busy, error } = useUpload(setNotice);
  const fileRef = useRef<HTMLInputElement>(null);
  const [engagementId, setEngagementId] = useState("");

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            aria-label="Upload file"
            className="text-xs file:mr-2 file:h-8 file:px-3 file:rounded-md file:border-0 file:bg-slate-900 file:text-white file:text-xs file:cursor-pointer text-slate-500"
          />
          {engagements.length > 0 && canManage && (
            <select
              value={engagementId}
              onChange={(e) => setEngagementId(e.target.value)}
              className={selectCls}
              aria-label="File against engagement"
            >
              <option value="">Intake (no engagement)</option>
              {engagements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              const file = fileRef.current?.files?.[0];
              if (file) void upload({ clientId, engagementId }, file);
            }}
          >
            <FileUp /> {busy ? "Scanning…" : "Upload"}
          </Button>
          <span className="text-[11px] text-slate-400">PDF, images, Office, CSV · max 25 MB</span>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {notice && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-xs text-slate-700">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {docs.length === 0 && <p className="text-sm text-slate-400">No documents yet.</p>}
      <ul className="space-y-2">
        {docs.map((d) => (
          <DocumentRow key={d.id} doc={d} engagements={engagements} canManage={canManage} />
        ))}
      </ul>
    </div>
  );
}

function DocumentRow({
  doc,
  engagements,
  canManage,
}: {
  doc: DocRow;
  engagements: EngagementOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const meta = DOC_STATUS_META[doc.status];

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const res = await fn();
      setMsg(res?.error ?? (res?.autoAdvancedTo ? `Moved to “${res.autoAdvancedTo}”.` : null));
      router.refresh();
    });

  return (
    <li className="text-sm border-b border-[var(--color-border)] last:border-0 pb-2 last:pb-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-slate-800 truncate max-w-60" title={doc.filename}>
          {doc.filename}
        </span>
        <Badge variant={meta.badge}>{meta.label}</Badge>
        {doc.source === "portal_upload" && <Badge variant="accent">Portal</Badge>}
        {doc.status === "infected" && doc.scanResult && (
          <span className="text-[11px] text-red-600 font-mono">{doc.scanResult}</span>
        )}
        <span className="text-xs text-slate-400">
          {formatBytes(doc.sizeBytes)} · {new Date(doc.createdAt).toLocaleDateString("en-CA")}
          {doc.uploaderName ? ` · ${doc.uploaderName}` : ""}
        </span>
        <span className="flex-1" />
        {doc.engagementLabel ? (
          <span className="text-xs text-slate-500">{doc.engagementLabel}</span>
        ) : (
          doc.status === "clean" &&
          canManage &&
          engagements.length > 0 && (
            <select
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                if (e.target.value) run(() => assignDocument(doc.id, e.target.value));
              }}
              className={selectCls}
              aria-label="File against engagement"
            >
              <option value="">File against…</option>
              {engagements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          )
        )}
        {doc.status === "clean" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await getDownloadUrl(doc.id);
                if (res.url) window.open(res.url, "_blank", "noopener");
                else setMsg(res.error ?? null);
              })
            }
          >
            <Download /> Download
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
      {msg && <p className="text-xs text-slate-500 mt-1">{msg}</p>}
    </li>
  );
}

export function ChecklistPanel({
  clientId,
  engagementId,
  items,
  canManage,
}: {
  clientId: string;
  engagementId: string;
  items: ChecklistItemRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const { upload, busy, error } = useUpload(setMsg);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const res = await fn();
      setMsg(res?.error ?? (res?.autoAdvancedTo ? `Engagement moved to “${res.autoAdvancedTo}”.` : null));
      router.refresh();
    });

  if (items.length === 0) {
    return canManage ? (
      <div className="mt-2 pl-4 border-l-2 border-slate-100">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => generateChecklist(engagementId))}>
          <ListChecks /> Generate document checklist
        </Button>
        {msg && <p className="text-xs text-slate-500 mt-1">{msg}</p>}
      </div>
    ) : null;
  }

  const done = items.filter((i) => i.status !== "missing").length;

  return (
    <div className="mt-2 pl-4 border-l-2 border-slate-100 space-y-1.5">
      <div className="text-xs text-slate-500">
        Document checklist · {done}/{items.length} in
      </div>
      <ul className="space-y-1">
        {items.map((i) => {
          const meta = CHECKLIST_STATUS_META[i.status];
          return (
            <li key={i.id} className="flex items-center gap-2 text-xs flex-wrap">
              <Badge variant={meta.badge} className="w-20 justify-center shrink-0">
                {meta.label}
              </Badge>
              <span className={i.status === "waived" ? "text-slate-400 line-through" : "text-slate-700"}>
                {i.title}
                {i.required && <span className="text-red-400"> *</span>}
              </span>
              {i.documentName && <span className="text-slate-400">({i.documentName})</span>}
              <span className="flex-1" />
              {canManage && (
                <span className="flex items-center gap-1">
                  {i.status === "missing" && (
                    <>
                      <label className="cursor-pointer text-indigo-600 hover:underline">
                        {busy ? "scanning…" : "upload"}
                        <input
                          type="file"
                          className="hidden"
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              void upload({ clientId, engagementId, checklistItemId: i.id }, file);
                              e.target.value = "";
                            }
                          }}
                        />
                      </label>
                      <button
                        className="text-slate-500 hover:underline"
                        disabled={pending}
                        onClick={() => run(() => setChecklistItemStatus(i.id, "received"))}
                      >
                        got it
                      </button>
                      <button
                        className="text-slate-500 hover:underline"
                        disabled={pending}
                        onClick={() => run(() => setChecklistItemStatus(i.id, "waived"))}
                      >
                        waive
                      </button>
                    </>
                  )}
                  {i.status !== "missing" && (
                    <button
                      className="text-slate-500 hover:underline"
                      disabled={pending}
                      onClick={() => run(() => setChecklistItemStatus(i.id, "missing"))}
                    >
                      reset
                    </button>
                  )}
                  <button
                    className="text-slate-400 hover:text-red-600"
                    aria-label={`Remove ${i.title}`}
                    disabled={pending}
                    onClick={() => run(() => removeChecklistItem(i.id))}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {canManage && <AddItemForm engagementId={engagementId} />}
      {(msg || error) && <p className="text-xs text-slate-500">{msg ?? error}</p>}
    </div>
  );
}

function AddItemForm({ engagementId }: { engagementId: string }) {
  const [state, formAction, pending] = useActionState(
    (prev: ActionResult, fd: FormData) => addChecklistItem(engagementId, prev, fd),
    null
  );
  return (
    <form action={formAction} className="flex items-center gap-2 flex-wrap pt-1">
      <input
        name="title"
        required
        placeholder="Add an item…"
        className="h-7 px-2 text-xs rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none w-52"
      />
      <label className="flex items-center gap-1 text-[11px] text-slate-500">
        <input type="checkbox" name="required" className="rounded" /> required
      </label>
      <Button size="sm" variant="outline" type="submit" disabled={pending}>
        Add
      </Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
