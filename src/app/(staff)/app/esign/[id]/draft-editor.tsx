"use client";

import { PenLine, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FieldPlacement } from "@/db/schema";
import {
  getSourceViewUrl,
  sendSignature,
  updateSignatureDraft,
  cancelSignature,
  type EsignActionResult,
} from "../actions";

/**
 * Draft signature editor (M6): configure signer + mode, place fields on
 * aspect-true page boxes (ADR-0025 — no in-browser PDF renderer), then send
 * remotely or sign in person. Every step persists the draft first, so what's
 * saved matches what's sent/signed.
 */

type PageSize = { width: number; height: number };
type FieldKind = "signature" | "initials" | "date";

const KIND_LABEL: Record<FieldKind, string> = {
  signature: "Signature",
  initials: "Initials",
  date: "Date",
};
// Sensible default sizes as a fraction of the page.
const KIND_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.28, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  date: { w: 0.18, h: 0.035 },
};

export function DraftEditor({
  requestId,
  pages,
  initial,
  engagements,
}: {
  requestId: string;
  pages: PageSize[];
  initial: {
    title: string;
    mode: "remote" | "in_person";
    signerName: string;
    signerEmail: string;
    signerPhone: string;
    engagementId: string | null;
    placements: FieldPlacement[];
  };
  engagements: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [mode, setMode] = useState(initial.mode);
  const [signerName, setSignerName] = useState(initial.signerName);
  const [signerEmail, setSignerEmail] = useState(initial.signerEmail);
  const [signerPhone, setSignerPhone] = useState(initial.signerPhone);
  const [engagementId, setEngagementId] = useState(initial.engagementId ?? "");
  const [placements, setPlacements] = useState<FieldPlacement[]>(initial.placements);
  const [pendingKind, setPendingKind] = useState<FieldKind>("signature");
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function currentPayload() {
    return {
      title,
      mode,
      signerName,
      signerEmail,
      signerPhone,
      engagementId: engagementId || null,
      placements,
    };
  }

  /** Persist the draft; returns error string or null. */
  async function persist(): Promise<string | null> {
    const res = await updateSignatureDraft(requestId, currentPayload());
    return res.error ?? null;
  }

  const run = (fn: () => Promise<EsignActionResult | string | null>) =>
    startTransition(async () => {
      setMsg(null);
      const err = await persist();
      if (err) {
        setMsg(err);
        return;
      }
      const res = await fn();
      const error = typeof res === "string" ? res : (res?.error ?? null);
      if (error) setMsg(error);
      else router.refresh();
    });

  const saveOnly = () =>
    startTransition(async () => {
      setMsg(null);
      const err = await persist();
      setMsg(err ?? "Saved.");
      if (!err) router.refresh();
    });

  const send = () =>
    run(async () => {
      const res = await sendSignature(requestId);
      if (!res.error) router.push(`/app/esign/${requestId}`);
      return res;
    });

  const signInPerson = () =>
    run(async () => {
      router.push(`/app/esign/${requestId}/sign`);
      return null;
    });

  const cancel = () =>
    startTransition(async () => {
      const res = await cancelSignature(requestId);
      if (res.error) setMsg(res.error);
      else router.push("/app/esign");
    });

  const canSend =
    placements.length > 0 && (mode === "in_person" || !!signerPhone || !!signerEmail);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium">Place the signature fields</CardTitle>
            <ViewSourceButton requestId={requestId} />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">Add:</span>
              {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPendingKind(k)}
                  className={`px-2.5 py-1 text-xs rounded-md border ${
                    pendingKind === k
                      ? "border-slate-800 bg-slate-800 text-white"
                      : "border-slate-300 text-slate-600 bg-white"
                  }`}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
              <span className="text-xs text-slate-400">
                Click a page to drop a {KIND_LABEL[pendingKind].toLowerCase()} field, then drag to
                position.
              </span>
            </div>

            <div className="space-y-4">
              {pages.map((p, i) => (
                <PageBox
                  key={i}
                  index={i}
                  size={p}
                  pendingKind={pendingKind}
                  placements={placements}
                  setPlacements={setPlacements}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Form title">
              <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Signer name">
              <input
                className={inputCls}
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
              />
            </Field>
            <Field label="Signer email">
              <input
                className={inputCls}
                type="email"
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Signer phone">
              <input
                className={inputCls}
                value={signerPhone}
                onChange={(e) => setSignerPhone(e.target.value)}
                placeholder="For the portal link"
              />
            </Field>
            {engagements.length > 0 && (
              <Field label="Return">
                <select
                  className={inputCls}
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                >
                  <option value="">Not linked</option>
                  {engagements.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Signing mode">
              <select
                className={inputCls}
                value={mode}
                onChange={(e) => setMode(e.target.value as "remote" | "in_person")}
              >
                <option value="remote">Remote — client signs in their portal</option>
                <option value="in_person">In person — sign on this device</option>
              </select>
            </Field>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <Button className="w-full" disabled={pending || !canSend} onClick={send}>
            {mode === "remote" ? "Send for signature" : "Mark ready & notify"}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            disabled={pending || placements.length === 0}
            onClick={signInPerson}
          >
            <PenLine /> Sign in person now
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={saveOnly}>
              Save draft
            </Button>
            <Button variant="outline" size="sm" disabled={pending} onClick={cancel}>
              Cancel request
            </Button>
          </div>
          {!canSend && placements.length === 0 && (
            <p className="text-xs text-slate-400">Add at least one field to send.</p>
          )}
          {msg && <p className="text-xs text-slate-600">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function PageBox({
  index,
  size,
  pendingKind,
  placements,
  setPlacements,
}: {
  index: number;
  size: PageSize;
  pendingKind: FieldKind;
  placements: FieldPlacement[];
  setPlacements: React.Dispatch<React.SetStateAction<FieldPlacement[]>>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);
  const pageFields = placements.filter((p) => p.page === index);

  function addAt(e: React.MouseEvent<HTMLDivElement>) {
    if (dragId.current) return; // finishing a drag, not a place-click
    const rect = boxRef.current!.getBoundingClientRect();
    const { w, h } = KIND_SIZE[pendingKind];
    const xPct = clamp((e.clientX - rect.left) / rect.width - w / 2, 0, 1 - w);
    const yPct = clamp((e.clientY - rect.top) / rect.height - h / 2, 0, 1 - h);
    const id = `f_${Math.round(xPct * 1000)}_${Math.round(yPct * 1000)}_${pageFields.length}`;
    setPlacements((prev) => [
      ...prev,
      { id, page: index, xPct, yPct, wPct: w, hPct: h, kind: pendingKind },
    ]);
  }

  function onFieldPointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    dragId.current = id;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragId.current) return;
    const rect = boxRef.current!.getBoundingClientRect();
    setPlacements((prev) =>
      prev.map((p) => {
        if (p.id !== dragId.current) return p;
        const xPct = clamp((e.clientX - rect.left) / rect.width - p.wPct / 2, 0, 1 - p.wPct);
        const yPct = clamp((e.clientY - rect.top) / rect.height - p.hPct / 2, 0, 1 - p.hPct);
        return { ...p, xPct, yPct };
      })
    );
  }
  function onPointerUp() {
    // Defer clearing so the trailing click on the box is suppressed.
    const held = dragId.current;
    if (held) setTimeout(() => (dragId.current = null), 0);
  }

  function remove(id: string) {
    setPlacements((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-1">Page {index + 1}</div>
      <div
        ref={boxRef}
        data-testid="esign-page-box"
        onClick={addAt}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative w-full bg-white ring-1 ring-slate-300 rounded-sm cursor-crosshair select-none"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {pageFields.map((f) => (
          <div
            key={f.id}
            onPointerDown={(e) => onFieldPointerDown(e, f.id)}
            className="absolute flex items-center justify-center rounded-sm border-2 border-indigo-500 bg-indigo-100/70 cursor-move group"
            style={{
              left: `${f.xPct * 100}%`,
              top: `${f.yPct * 100}%`,
              width: `${f.wPct * 100}%`,
              height: `${f.hPct * 100}%`,
            }}
          >
            <span className="text-[10px] font-medium text-indigo-800 pointer-events-none truncate px-1">
              {KIND_LABEL[f.kind]}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(f.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute -top-2 -right-2 hidden group-hover:flex items-center justify-center h-4 w-4 rounded-full bg-red-600 text-white"
              aria-label={`Remove ${KIND_LABEL[f.kind]} field`}
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewSourceButton({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await getSourceViewUrl(requestId);
          if (res.url) window.open(res.url, "_blank", "noopener");
        })
      }
    >
      View the form
    </Button>
  );
}

const inputCls =
  "w-full h-9 px-2.5 text-sm rounded-md bg-white ring-1 ring-slate-300 focus:ring-slate-400 outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}
