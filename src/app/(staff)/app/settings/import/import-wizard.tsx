"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  commitImport,
  discardBatch,
  previewImport,
  rollbackImport,
  saveMappingTemplate,
  stageImport,
  type StagedPreviewRow,
} from "./actions";

/**
 * The generic import wizard (M9, ADR-0033): Upload → Map columns → Review →
 * Import, then an undo. CSV text lives in client state so a mapping change
 * re-stages from the same source; the server owns all parsing/validation.
 */

type TargetField = {
  key: string;
  label: string;
  group: "core" | "contact" | "address" | "sensitive";
  required?: boolean;
  hint?: string;
};

type TemplateOpt = { id: string; name: string; mapping: Record<string, string> };

const IGNORE = "__ignore__";
const CUSTOM_PREFIX = "custom:";

const selectCls =
  "h-8 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none";

type Preview = {
  headers: string[];
  delimiter: string;
  rowCount: number;
  sampleRows: string[][];
  warnings: string[];
};

type Staged = {
  batchId: string;
  rowCount: number;
  createCount: number;
  skipCount: number;
  warningCount: number;
  preview: StagedPreviewRow[];
};

export function ImportWizard({
  targetFields,
  templates,
  sampleCsv,
}: {
  targetFields: TargetField[];
  templates: TemplateOpt[];
  sampleCsv: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [staged, setStaged] = useState<Staged | null>(null);
  const [commit, setCommit] = useState<{ createdCount: number; unresolvedAccountants: number } | null>(null);
  const [rollback, setRollback] = useState<
    { removed: number; kept: Array<{ name: string }>; status: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const csvRef = useRef<HTMLTextAreaElement>(null);

  function reset() {
    setStep(1);
    setCsv("");
    setPreview(null);
    setMapping({});
    setStaged(null);
    setCommit(null);
    setRollback(null);
    setError(null);
    if (csvRef.current) csvRef.current.value = "";
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsv(text);
      if (csvRef.current) csvRef.current.value = text;
    };
    reader.readAsText(file);
  }

  function doPreview() {
    setError(null);
    startTransition(async () => {
      const res = await previewImport(csv);
      if ("error" in res) return setError(res.error);
      setPreview({
        headers: res.headers,
        delimiter: res.delimiter,
        rowCount: res.rowCount,
        sampleRows: res.sampleRows,
        warnings: res.warnings,
      });
      setMapping(res.suggestedMapping);
      setStep(2);
    });
  }

  function doStage() {
    setError(null);
    startTransition(async () => {
      const res = await stageImport(csv, JSON.stringify(mapping), staged?.batchId);
      if ("error" in res) return setError(res.error);
      setStaged(res);
      setStep(3);
    });
  }

  function doCommit() {
    if (!staged) return;
    setError(null);
    startTransition(async () => {
      const res = await commitImport(staged.batchId);
      if ("error" in res) return setError(res.error);
      setCommit(res);
      setStep(4);
    });
  }

  function doRollback() {
    if (!staged) return;
    setError(null);
    startTransition(async () => {
      const res = await rollbackImport(staged.batchId);
      if ("error" in res) return setError(res.error);
      setRollback(res);
    });
  }

  function backToUpload() {
    if (staged) {
      const id = staged.batchId;
      startTransition(async () => {
        await discardBatch(id);
      });
    }
    reset();
  }

  return (
    <div className="space-y-6" data-testid="import-wizard">
      <Stepper step={step} />
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {step === 1 && (
        <UploadStep
          csvRef={csvRef}
          onChange={setCsv}
          onFile={onFile}
          onLoadSample={() => {
            setCsv(sampleCsv);
            if (csvRef.current) csvRef.current.value = sampleCsv;
          }}
          onContinue={doPreview}
          pending={pending}
          hasCsv={csv.trim().length > 0}
        />
      )}

      {step === 2 && preview && (
        <MapStep
          preview={preview}
          mapping={mapping}
          setMapping={setMapping}
          targetFields={targetFields}
          templates={templates}
          onBack={() => setStep(1)}
          onPreview={doStage}
          pending={pending}
          csv={csv}
        />
      )}

      {step === 3 && staged && (
        <ReviewStep
          staged={staged}
          onBack={() => setStep(2)}
          onCommit={doCommit}
          onDiscard={backToUpload}
          pending={pending}
        />
      )}

      {step === 4 && commit && (
        <DoneStep
          commit={commit}
          rollback={rollback}
          onRollback={doRollback}
          onNew={reset}
          pending={pending}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = ["Upload", "Map columns", "Review", "Done"];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 " +
                (active
                  ? "bg-slate-900 text-white ring-slate-900"
                  : done
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-white text-slate-500 ring-slate-200")
              }
            >
              <span className="font-semibold">{n}</span>
              {label}
            </span>
            {i < steps.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

function UploadStep({
  csvRef,
  onChange,
  onFile,
  onLoadSample,
  onContinue,
  pending,
  hasCsv,
}: {
  csvRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (v: string) => void;
  onFile: (f: File) => void;
  onLoadSample: () => void;
  onContinue: () => void;
  pending: boolean;
  hasCsv: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Upload or paste a CSV of clients. The first row must be column headers. We&apos;ll map the
        columns onto client fields, flag anything odd, and let you review before creating anyone.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm">
          <span className="sr-only">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            data-testid="import-file"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-white hover:file:bg-slate-800"
          />
        </label>
        <button
          type="button"
          onClick={onLoadSample}
          className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
        >
          Load sample CSV
        </button>
      </div>
      <textarea
        ref={csvRef}
        data-testid="import-csv"
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        placeholder={"name,email,province,SIN,Referral Source\nAda Lovelace,ada@example.com,ON,046454286,Website"}
        className="w-full px-3 py-2 text-sm font-mono rounded-md bg-slate-50 ring-1 ring-slate-200 focus:bg-white focus:ring-slate-400 outline-none resize-y"
      />
      <Button data-testid="import-continue" onClick={onContinue} disabled={pending || !hasCsv}>
        {pending ? "Reading…" : "Continue"}
      </Button>
    </div>
  );
}

function MapStep({
  preview,
  mapping,
  setMapping,
  targetFields,
  templates,
  onBack,
  onPreview,
  pending,
  csv,
}: {
  preview: Preview;
  mapping: Record<string, string>;
  setMapping: (m: Record<string, string>) => void;
  targetFields: TargetField[];
  templates: TemplateOpt[];
  onBack: () => void;
  onPreview: () => void;
  pending: boolean;
  csv: string;
}) {
  const [templateName, setTemplateName] = useState("");
  const [templateMsg, setTemplateMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sampleFor = (colIdx: number) =>
    preview.sampleRows.map((r) => r[colIdx]).filter((v) => v && v.trim()).slice(0, 3);

  function setCol(header: string, value: string) {
    setMapping({ ...mapping, [header]: value });
  }

  function applyTemplate(id: string) {
    const t = templates.find((t) => t.id === id);
    if (!t) return;
    // Keep any headers the template doesn't mention on their suggestion.
    const next = { ...mapping };
    for (const h of preview.headers) if (t.mapping[h]) next[h] = t.mapping[h];
    setMapping(next);
  }

  const mappedTargets = Object.values(mapping);
  const hasName = mappedTargets.includes("displayName");

  return (
    <div className="space-y-4" data-testid="import-mapping">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600">
          {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"} · {preview.headers.length} columns.
          Match each column to a client field, mark it a custom field, or ignore it.
        </p>
        {templates.length > 0 && (
          <label className="text-xs text-slate-500 flex items-center gap-1.5">
            Load saved mapping
            <select
              className={selectCls}
              defaultValue=""
              onChange={(e) => e.target.value && applyTemplate(e.target.value)}
            >
              <option value="">Choose…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {preview.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 space-y-0.5">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
              <th className="py-2 px-3 font-medium">CSV column</th>
              <th className="py-2 px-3 font-medium">Sample values</th>
              <th className="py-2 px-3 font-medium">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {preview.headers.map((header, idx) => {
              if (!header) return null;
              const value = mapping[header] ?? IGNORE;
              const isCustom = value.startsWith(CUSTOM_PREFIX);
              return (
                <tr key={header} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 px-3 font-medium text-slate-800">{header}</td>
                  <td className="py-2 px-3 text-slate-500 text-xs">
                    {sampleFor(idx).join(" · ") || "—"}
                  </td>
                  <td className="py-2 px-3">
                    <select
                      data-testid={`map-${header}`}
                      className={selectCls}
                      value={isCustom ? CUSTOM_PREFIX + header : value}
                      onChange={(e) =>
                        setCol(header, e.target.value === CUSTOM_PREFIX + header ? CUSTOM_PREFIX + header : e.target.value)
                      }
                    >
                      <option value={IGNORE}>Ignore this column</option>
                      <optgroup label="Client fields">
                        {targetFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " (required)" : ""}
                          </option>
                        ))}
                      </optgroup>
                      <option value={CUSTOM_PREFIX + header}>Custom field “{header}”</option>
                    </select>
                    {isCustom && (
                      <span className="ml-2 text-xs text-indigo-600">→ custom field</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!hasName && (
        <p className="text-sm text-amber-700">
          Map a column to <strong>Name</strong> — rows without a name can&apos;t create a client.
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap border-t border-slate-100 pt-3">
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Save this mapping as…"
          className="h-8 px-2 text-sm rounded-md bg-white ring-1 ring-slate-200 focus:ring-slate-400 outline-none"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!templateName.trim()}
          onClick={() =>
            startTransition(async () => {
              setTemplateMsg(null);
              const res = await saveMappingTemplate(templateName.trim(), JSON.stringify(mapping));
              setTemplateMsg(res.ok ? "Saved." : (res.error ?? "Couldn't save."));
            })
          }
        >
          Save mapping
        </Button>
        {templateMsg && <span className="text-xs text-slate-500">{templateMsg}</span>}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          Back
        </Button>
        <Button data-testid="import-preview" onClick={onPreview} disabled={pending || !hasName || !csv}>
          {pending ? "Checking…" : "Preview import"}
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({
  staged,
  onBack,
  onCommit,
  onDiscard,
  pending,
}: {
  staged: Staged;
  onBack: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  pending: boolean;
}) {
  const customKeys = Array.from(
    new Set(staged.preview.flatMap((r) => Object.keys(r.customFields)))
  );
  return (
    <div className="space-y-4" data-testid="import-review">
      <div className="flex items-center gap-2 flex-wrap text-sm" data-testid="import-summary">
        <Badge variant="success">{staged.createCount} to import</Badge>
        {staged.skipCount > 0 && <Badge variant="warn">{staged.skipCount} skipped</Badge>}
        {staged.warningCount > 0 && (
          <Badge variant="warn">{staged.warningCount} warning{staged.warningCount === 1 ? "" : "s"}</Badge>
        )}
        {customKeys.length > 0 && (
          <span className="text-xs text-slate-500">
            Custom fields: {customKeys.join(", ")}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-md ring-1 ring-slate-200 max-h-[28rem]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="py-2 px-3 font-medium">#</th>
              <th className="py-2 px-3 font-medium">Name</th>
              <th className="py-2 px-3 font-medium">Type</th>
              <th className="py-2 px-3 font-medium">Email</th>
              <th className="py-2 px-3 font-medium">SIN</th>
              {customKeys.map((k) => (
                <th key={k} className="py-2 px-3 font-medium">{k}</th>
              ))}
              <th className="py-2 px-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {staged.preview.map((r) => (
              <tr
                key={r.rowNumber}
                data-testid={`import-row-${r.action}`}
                className={"border-b border-slate-100 last:border-0 " + (r.action === "skip" ? "opacity-60" : "")}
              >
                <td className="py-1.5 px-3 text-slate-400">{r.rowNumber}</td>
                <td className="py-1.5 px-3 font-medium text-slate-800">
                  {r.displayName ?? <span className="text-red-600">— skipped —</span>}
                </td>
                <td className="py-1.5 px-3 text-slate-600 capitalize">{r.type}</td>
                <td className="py-1.5 px-3 text-slate-600">{r.email ?? "—"}</td>
                <td className="py-1.5 px-3">{r.hasSin ? <Badge variant="accent">encrypted</Badge> : "—"}</td>
                {customKeys.map((k) => (
                  <td key={k} className="py-1.5 px-3 text-slate-600">{r.customFields[k] ?? "—"}</td>
                ))}
                <td className="py-1.5 px-3">
                  {r.warnings.length > 0 ? (
                    <ul className="text-xs text-amber-700 space-y-0.5">
                      {r.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-emerald-600">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          Back to mapping
        </Button>
        <Button
          data-testid="import-commit"
          onClick={onCommit}
          disabled={pending || staged.createCount === 0}
        >
          {pending ? "Importing…" : `Import ${staged.createCount} client${staged.createCount === 1 ? "" : "s"}`}
        </Button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={pending}
          className="text-sm text-slate-500 hover:text-red-600 underline underline-offset-2"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  commit,
  rollback,
  onRollback,
  onNew,
  pending,
}: {
  commit: { createdCount: number; unresolvedAccountants: number };
  rollback: { removed: number; kept: Array<{ name: string }>; status: string } | null;
  onRollback: () => void;
  onNew: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-4" data-testid="import-done">
      {!rollback ? (
        <>
          <div className="rounded-md bg-emerald-50 ring-1 ring-emerald-200 p-4">
            <p className="text-sm font-medium text-emerald-800">
              Imported {commit.createdCount} client{commit.createdCount === 1 ? "" : "s"}.
            </p>
            {commit.unresolvedAccountants > 0 && (
              <p className="text-xs text-amber-700 mt-1">
                {commit.unresolvedAccountants} row(s) named an accountant we couldn&apos;t match — those
                clients were left unassigned.
              </p>
            )}
            <p className="text-xs text-slate-600 mt-2">
              Changed your mind? You can undo this import — it removes exactly the clients it created,
              as long as none have been worked on since.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/app/clients">
              <Button>View clients</Button>
            </Link>
            <Button variant="outline" onClick={onNew} disabled={pending}>
              Import another file
            </Button>
            <button
              type="button"
              data-testid="import-rollback"
              onClick={onRollback}
              disabled={pending}
              className="text-sm text-slate-500 hover:text-red-600 underline underline-offset-2"
            >
              {pending ? "Rolling back…" : "Undo this import"}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-3" data-testid="import-rollback-result">
          <div className="rounded-md bg-slate-50 ring-1 ring-slate-200 p-4">
            <p className="text-sm font-medium text-slate-800">
              {rollback.status === "rolled_back"
                ? `Undone — removed ${rollback.removed} imported client${rollback.removed === 1 ? "" : "s"}.`
                : `Partly undone — removed ${rollback.removed}, kept ${rollback.kept.length}.`}
            </p>
            {rollback.kept.length > 0 && (
              <p className="text-xs text-amber-700 mt-1">
                Kept (worked on since import): {rollback.kept.map((k) => k.name).join(", ")}.
              </p>
            )}
          </div>
          <Button variant="outline" onClick={onNew} disabled={pending}>
            Import another file
          </Button>
        </div>
      )}
    </div>
  );
}
