"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Signature capture (M6), shared by staff in-person signing and the portal
 * remote-signing surface. Two accessible ways to sign — DRAW on a canvas or
 * TYPE your name — because an elderly client on a trackpad often can't draw a
 * usable signature (portal AAA posture). Emits a normalised mark the server
 * turns into the stamped PDF; `null` while empty.
 *
 * No dependency: raw canvas + pointer events. The drawn image is exported as a
 * PNG data URL; the typed name is sent as text and rendered in an italic font
 * server-side.
 */

export type SignatureMarkValue =
  | { method: "drawn"; png: string }
  | { method: "typed"; name: string };

export function SignaturePad({
  onChange,
  defaultTypedName = "",
  variant = "staff",
}: {
  onChange: (mark: SignatureMarkValue | null) => void;
  defaultTypedName?: string;
  variant?: "staff" | "portal";
}) {
  const [tab, setTab] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(defaultTypedName);
  const portal = variant === "portal";

  // Re-emit when switching tabs / editing the typed name.
  useEffect(() => {
    if (tab === "type") {
      const name = typed.trim();
      onChange(name ? { method: "typed", name } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, typed]);

  return (
    <div className={portal ? "space-y-4" : "space-y-2"}>
      <div className="flex gap-2" role="tablist" aria-label="How to sign">
        <TabButton active={tab === "draw"} portal={portal} onClick={() => setTab("draw")}>
          Draw
        </TabButton>
        <TabButton active={tab === "type"} portal={portal} onClick={() => setTab("type")}>
          Type your name
        </TabButton>
      </div>

      {tab === "draw" ? (
        <DrawCanvas portal={portal} onChange={onChange} />
      ) : (
        <div className="space-y-2">
          <label
            htmlFor="typed-signature"
            className={portal ? "block text-[17px] font-semibold" : "block text-xs text-slate-500"}
          >
            Type your full name to sign
          </label>
          <input
            id="typed-signature"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className={
              portal
                ? "w-full rounded-lg border-2 border-[#26374a] px-4 py-3 text-2xl"
                : "w-full rounded-md ring-1 ring-slate-300 px-3 py-2 text-lg"
            }
            placeholder="Your name"
          />
          {typed.trim() && (
            <p
              className="rounded-md bg-slate-50 px-4 py-3 text-3xl text-slate-800"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic" }}
            >
              {typed.trim()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  portal,
  onClick,
  children,
}: {
  active: boolean;
  portal: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = portal
    ? "px-4 py-2 text-[17px] font-semibold rounded-lg border-2"
    : "px-3 py-1.5 text-sm font-medium rounded-md border";
  const on = portal
    ? "border-[#26374a] bg-[#26374a] text-white"
    : "border-slate-800 bg-slate-800 text-white";
  const off = portal
    ? "border-[#26374a] text-[#26374a] bg-white"
    : "border-slate-300 text-slate-600 bg-white";
  return (
    <button type="button" role="tab" aria-selected={active} className={`${base} ${active ? on : off}`} onClick={onClick}>
      {children}
    </button>
  );
}

function DrawCanvas({
  portal,
  onChange,
}: {
  portal: boolean;
  onChange: (mark: SignatureMarkValue | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Size the backing store to the element for crisp lines on hi-DPI screens.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = portal ? 3 : 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0b1220";
    }
  }, [portal]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    hasInk.current = true;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (hasInk.current) {
      setEmpty(false);
      const png = canvasRef.current?.toDataURL("image/png");
      onChange(png ? { method: "drawn", png } : null);
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        aria-label="Signature drawing area"
        className={
          portal
            ? "w-full rounded-lg border-2 border-[#26374a] bg-white touch-none"
            : "w-full rounded-md ring-1 ring-slate-300 bg-white touch-none"
        }
        style={{ height: portal ? 200 : 150 }}
      />
      <div className="flex items-center justify-between">
        <span className={portal ? "text-[15px] text-slate-600" : "text-xs text-slate-400"}>
          {empty ? "Sign with your finger or mouse above." : "Looks good."}
        </span>
        <button
          type="button"
          onClick={clear}
          className={
            portal
              ? "text-[15px] font-semibold text-[#26374a] underline underline-offset-2"
              : "text-xs text-slate-500 underline underline-offset-2"
          }
        >
          Clear
        </button>
      </div>
    </div>
  );
}
