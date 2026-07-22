"use client";

import { Camera, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { ScanCapture } from "./scan-capture";

/**
 * Portal upload flow (M4): whose document → what it is → photo or file →
 * send → plain-language outcome. One question per screen, big targets, and
 * a "start over" path everywhere — designed for elderly clients on phones.
 */

type ClientOption = { id: string; name: string };
type MissingItem = { id: string; title: string; clientId: string; engagementLabel: string };

type Outcome = "received" | "rejected" | "held";

const btnPrimary =
  "w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a] disabled:opacity-60";
const btnChoice =
  "flex w-full items-center gap-4 rounded-xl border-2 border-[#26374a] bg-white p-5 text-left text-lg font-semibold text-[#26374a] hover:bg-slate-50";

export function UploadFlow({
  clients,
  defaultClientId,
  missingItems,
  preselectedItemId,
}: {
  clients: ClientOption[];
  defaultClientId: string;
  missingItems: MissingItem[];
  preselectedItemId: string | null;
}) {
  const preselected = missingItems.find((i) => i.id === preselectedItemId) ?? null;

  const [clientId, setClientId] = useState<string | null>(
    preselected ? preselected.clientId : clients.length === 1 ? defaultClientId : null
  );
  const [item, setItem] = useState<MissingItem | null>(preselected);
  const [itemChosen, setItemChosen] = useState(preselected !== null);
  const [file, setFile] = useState<File | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setClientId(clients.length === 1 ? defaultClientId : null);
    setItem(null);
    setItemChosen(false);
    setFile(null);
    setCapturing(false);
    setOutcome(null);
    setError(null);
  };

  async function send() {
    if (!file || !clientId) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("clientId", clientId);
      if (item) form.set("checklistItemId", item.id);
      const res = await fetch("/api/portal/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { outcome?: Outcome; error?: string };
      if (!res.ok || !body.outcome) {
        setError(body.error ?? "Something went wrong. Please try again.");
      } else {
        setOutcome(body.outcome);
      }
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // ---- outcome screen --------------------------------------------------------
  if (outcome) {
    const copy = {
      received: {
        title: "We got it — thank you!",
        body: item
          ? `“${item.title}” is on its way to your accountant.`
          : "Your document is safely in your accountant's hands.",
      },
      rejected: {
        title: "We couldn't accept that file",
        body: "Our safety check flagged it. Nothing to worry about — please call the office and they'll help you send it another way.",
      },
      held: {
        title: "We received your document",
        body: "We're double-checking it on our side. Your accountant will follow up if anything else is needed.",
      },
    }[outcome];
    return (
      <div className="space-y-6">
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        <button className={btnPrimary} onClick={reset}>
          Send another document
        </button>
      </div>
    );
  }

  // ---- step 1: whose document ------------------------------------------------
  if (!clientId) {
    return (
      <div className="space-y-4">
        <h2>Whose document is this?</h2>
        {clients.map((c) => (
          <button key={c.id} className={btnChoice} onClick={() => setClientId(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
    );
  }

  // ---- step 2: what is it (only when there's a checklist to match) -----------
  const clientMissing = missingItems.filter((i) => i.clientId === clientId);
  if (!itemChosen && clientMissing.length > 0) {
    return (
      <div className="space-y-4">
        <h2>What are you sending?</h2>
        {clientMissing.map((i) => (
          <button
            key={i.id}
            className={btnChoice}
            onClick={() => {
              setItem(i);
              setItemChosen(true);
            }}
          >
            <span>
              {i.title}
              <span className="block text-[15px] font-normal text-slate-600">
                for the {i.engagementLabel}
              </span>
            </span>
          </button>
        ))}
        <button
          className={btnChoice}
          onClick={() => {
            setItem(null);
            setItemChosen(true);
          }}
        >
          Something else
        </button>
      </div>
    );
  }

  // ---- step 3: camera capture (jscanify) --------------------------------------
  if (capturing) {
    return (
      <ScanCapture
        onCaptured={(f) => {
          setFile(f);
          setCapturing(false);
        }}
        onCancel={() => setCapturing(false)}
      />
    );
  }

  // ---- step 3/4: pick or confirm the file -------------------------------------
  return (
    <div className="space-y-5">
      {item && (
        <p>
          Sending: <strong>{item.title}</strong> for the {item.engagementLabel}.
        </p>
      )}

      {!file ? (
        <>
          <h2>How would you like to send it?</h2>
          <button className={btnChoice} onClick={() => setCapturing(true)}>
            <Camera className="h-7 w-7 shrink-0" aria-hidden />
            <span>
              Take a photo of the paper
              <span className="block text-[15px] font-normal text-slate-600">
                Uses your camera. We&apos;ll straighten the page for you.
              </span>
            </span>
          </button>
          <button className={btnChoice} onClick={() => fileInputRef.current?.click()}>
            <FileUp className="h-7 w-7 shrink-0" aria-hidden />
            <span>
              Choose a file on this device
              <span className="block text-[15px] font-normal text-slate-600">
                A PDF or a photo you already have.
              </span>
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            aria-label="Choose a file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </>
      ) : (
        <>
          <h2>Ready to send</h2>
          <FilePreview file={file} />
          <button className={btnPrimary} onClick={send} disabled={sending}>
            {sending ? "Sending…" : "Send it now"}
          </button>
          <button
            className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
            onClick={() => setFile(null)}
            disabled={sending}
          >
            Pick a different file
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="font-semibold text-[#b10e1e]">
          {error}
        </p>
      )}
    </div>
  );
}

function FilePreview({ file }: { file: File }) {
  const [url] = useState(() => (file.type.startsWith("image/") ? URL.createObjectURL(file) : null));
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-3">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob preview
        <img src={url} alt="Preview of your photo" className="max-h-80 w-full object-contain" />
      ) : (
        <p className="font-semibold">{file.name}</p>
      )}
      <p className="mt-2 text-[15px] text-slate-600">
        {(file.size / 1024 / 1024).toFixed(1)} MB
      </p>
    </div>
  );
}
