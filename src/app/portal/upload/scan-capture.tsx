"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * jscanify document capture (M4). Live camera → continuous page detection
 * with an on-screen outline → snap → perspective-corrected result →
 * confirm. Both libraries load lazily from /public/vendor (copied from
 * node_modules on postinstall) so nothing crosses the same-origin CSP;
 * OpenCV's WASM needs the deliberate 'wasm-unsafe-eval' + worker-src
 * additions in next.config.ts.
 *
 * Real-device testing (2026-07-22) drove three things here:
 *  - The outline is drawn on the LIVE preview, so the client sees whether
 *    the page is found before pressing the shutter. Snapping blind and
 *    discovering afterwards that nothing was detected is the worst
 *    outcome for this audience.
 *  - Detected quads are quality-gated (size, convexity, aspect). A photo
 *    where the page runs off the frame yields a garbage quad, and warping
 *    to it produced a worse image than the plain photo.
 *  - Output dimensions come from the detected quad, not a hardcoded letter
 *    ratio — receipts and slips aren't 8.5×11.
 *
 * Every failure path (no camera, permission denied, OpenCV won't load, no
 * page found) falls back to the device's native camera file input, and a
 * plain photo is always an acceptable result — the accountant can read it.
 */

type Corner = { x: number; y: number };
type Quad = {
  topLeftCorner: Corner;
  topRightCorner: Corner;
  bottomLeftCorner: Corner;
  bottomRightCorner: Corner;
};

type CvMat = { delete: () => void; data32S?: Int32Array };

declare global {
  interface Window {
    cv?: { onRuntimeInitialized?: () => void; Mat?: unknown; imread?: (el: HTMLCanvasElement) => CvMat };
    jscanify?: new () => {
      findPaperContour: (img: CvMat) => CvMat | null;
      getCornerPoints: (contour: CvMat) => Partial<Quad>;
      extractPaper: (
        image: HTMLCanvasElement,
        width: number,
        height: number,
        corners?: Quad
      ) => HTMLCanvasElement | null;
    };
  }
}

/** Detection runs on a downscaled frame — plenty for edges, cheap on phones. */
const DETECT_WIDTH = 480;
/** ~6 fps: responsive enough to aim by, light enough not to cook the battery. */
const DETECT_INTERVAL_MS = 160;
/** Longest side of the straightened output. */
const MAX_OUTPUT_EDGE = 2200;

let vendorLoaded: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Load opencv.js (waiting for its WASM runtime) then jscanify, once. */
function loadVendor(): Promise<void> {
  vendorLoaded ??= (async () => {
    await loadScript("/vendor/opencv.js");
    await new Promise<void>((resolve, reject) => {
      const cv = window.cv;
      if (!cv) return reject(new Error("OpenCV missing after load"));
      if (cv.Mat) return resolve(); // runtime already up
      const timeout = setTimeout(() => reject(new Error("OpenCV runtime timeout")), 20_000);
      cv.onRuntimeInitialized = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    await loadScript("/vendor/jscanify.js");
    if (!window.jscanify) throw new Error("jscanify missing after load");
  })().catch((e) => {
    vendorLoaded = null; // allow a retry on the next mount
    throw e;
  });
  return vendorLoaded;
}

const dist = (a: Corner, b: Corner) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Reject implausible quads. jscanify happily returns the frame border or a
 * sliver of shadow as "the paper"; warping to those looks broken.
 */
function qualifyQuad(q: Partial<Quad>, width: number, height: number): Quad | null {
  const { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl } = q;
  if (!tl || !tr || !br || !bl) return null;
  const pts = [tl, tr, br, bl];

  // Shoelace area: too big means it grabbed the whole frame, too small is noise.
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    const n = pts[(i + 1) % 4];
    area += p.x * n.y - n.x * p.y;
  }
  area = Math.abs(area) / 2;
  const frame = width * height;
  if (area < frame * 0.06 || area > frame * 0.93) return null;

  // No slivers.
  const minSide = Math.min(dist(tl, tr), dist(tr, br), dist(br, bl), dist(bl, tl));
  if (minSide < Math.min(width, height) * 0.1) return null;

  // Convex only — a bow-tie or dented quad means the edges weren't the page.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return null;
  }

  // Plausible page proportions (portrait receipts through landscape ledgers).
  const w = (dist(tl, tr) + dist(bl, br)) / 2;
  const h = (dist(tl, bl) + dist(tr, br)) / 2;
  if (w <= 0 || h <= 0) return null;
  const aspect = w / h;
  if (aspect < 0.15 || aspect > 6.5) return null;

  return { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl };
}

/**
 * Detect the page in a canvas. Owns every Mat it creates — jscanify's own
 * highlightPaper leaks the contour, which a per-frame loop can't afford.
 */
function detectQuad(canvas: HTMLCanvasElement): Quad | null {
  const cv = window.cv;
  const Scanner = window.jscanify;
  if (!cv?.imread || !Scanner) return null;

  let img: CvMat | null = null;
  let contour: CvMat | null = null;
  try {
    img = cv.imread(canvas);
    const scanner = new Scanner();
    contour = scanner.findPaperContour(img);
    if (!contour) return null;
    return qualifyQuad(scanner.getCornerPoints(contour), canvas.width, canvas.height);
  } catch {
    return null;
  } finally {
    contour?.delete();
    img?.delete();
  }
}

function scaleQuad(q: Quad, factor: number): Quad {
  const s = (c: Corner) => ({ x: c.x * factor, y: c.y * factor });
  return {
    topLeftCorner: s(q.topLeftCorner),
    topRightCorner: s(q.topRightCorner),
    bottomRightCorner: s(q.bottomRightCorner),
    bottomLeftCorner: s(q.bottomLeftCorner),
  };
}

type Stage = "starting" | "live" | "review" | "fallback";

/** A captured frame: the canvas (for encoding) plus a data URL (for display). */
type Shot = { canvas: HTMLCanvasElement; url: string };

function toShot(canvas: HTMLCanvasElement): Shot {
  return { canvas, url: canvas.toDataURL("image/jpeg", 0.85) };
}

export function ScanCapture({
  onCaptured,
  onCancel,
}: {
  onCaptured: (file: File) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Latest good quad in DETECTION space, kept out of state (per-frame). */
  const quadRef = useRef<Quad | null>(null);

  const [stage, setStage] = useState<Stage>("starting");
  const [detected, setDetected] = useState(false);
  const [snapshot, setSnapshot] = useState<Shot | null>(null);
  const [result, setResult] = useState<{ shot: Shot; straightened: boolean } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1920 } },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    return stream;
  }, []);

  // Camera + vendor libraries spin up together; any failure → native input.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stream] = await Promise.all([startCamera(), loadVendor()]);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStage("live");
      } catch {
        if (!cancelled) setStage("fallback");
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [startCamera, stopStream]);

  // Live detection loop: downscale → detect → outline. Runs only while the
  // preview is on screen.
  useEffect(() => {
    if (stage !== "live") return;
    let stopped = false;
    let lastRun = 0;

    const tick = (now: number) => {
      if (stopped) return;
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastRun < DETECT_INTERVAL_MS) return;
      lastRun = now;

      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video?.videoWidth || !overlay) return;

      const scale = DETECT_WIDTH / video.videoWidth;
      const dw = DETECT_WIDTH;
      const dh = Math.round(video.videoHeight * scale);

      const detectCanvas = (detectCanvasRef.current ??= document.createElement("canvas"));
      if (detectCanvas.width !== dw || detectCanvas.height !== dh) {
        detectCanvas.width = dw;
        detectCanvas.height = dh;
      }
      detectCanvas.getContext("2d")!.drawImage(video, 0, 0, dw, dh);

      const quad = detectQuad(detectCanvas);
      quadRef.current = quad;
      setDetected(!!quad);

      if (overlay.width !== dw || overlay.height !== dh) {
        overlay.width = dw;
        overlay.height = dh;
      }
      const ctx = overlay.getContext("2d")!;
      ctx.clearRect(0, 0, dw, dh);
      if (quad) {
        const { topLeftCorner: tl, topRightCorner: tr, bottomRightCorner: br, bottomLeftCorner: bl } = quad;
        ctx.strokeStyle = "#00703c";
        ctx.lineWidth = 4;
        ctx.fillStyle = "rgba(0, 112, 60, 0.15)";
        ctx.beginPath();
        ctx.moveTo(tl.x, tl.y);
        ctx.lineTo(tr.x, tr.y);
        ctx.lineTo(br.x, br.y);
        ctx.lineTo(bl.x, bl.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [stage]);

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const frame = document.createElement("canvas");
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    frame.getContext("2d")!.drawImage(video, 0, 0);

    // Use the quad the client just saw outlined, scaled to full resolution —
    // re-detecting on the full frame could disagree with the preview.
    const previewQuad = quadRef.current;
    stopStream();
    const original = toShot(frame);
    setSnapshot(original);

    let extracted: HTMLCanvasElement | null = null;
    if (previewQuad) {
      try {
        const quad = scaleQuad(previewQuad, frame.width / DETECT_WIDTH);
        const w = (dist(quad.topLeftCorner, quad.topRightCorner) + dist(quad.bottomLeftCorner, quad.bottomRightCorner)) / 2;
        const h = (dist(quad.topLeftCorner, quad.bottomLeftCorner) + dist(quad.topRightCorner, quad.bottomRightCorner)) / 2;
        const shrink = Math.min(1, MAX_OUTPUT_EDGE / Math.max(w, h));
        extracted = new window.jscanify!().extractPaper(
          frame,
          Math.max(320, Math.round(w * shrink)),
          Math.max(320, Math.round(h * shrink)),
          quad
        );
      } catch {
        extracted = null;
      }
    }
    setResult(
      extracted
        ? { shot: toShot(extracted), straightened: true }
        : { shot: original, straightened: false }
    );
    setStage("review");
  }

  function confirm() {
    const canvas = result?.shot.canvas;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCaptured(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      0.9
    );
  }

  async function retake() {
    setResult(null);
    setSnapshot(null);
    quadRef.current = null;
    setDetected(false);
    setStage("starting");
    try {
      await startCamera();
      setStage("live");
    } catch {
      setStage("fallback");
    }
  }

  if (stage === "fallback") {
    return (
      <div className="space-y-5">
        <h2>Take a photo</h2>
        <p>We&apos;ll use your device&apos;s own camera.</p>
        <button
          className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a]"
          onClick={() => fallbackRef.current?.click()}
        >
          Open the camera
        </button>
        <input
          ref={fallbackRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Take a photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCaptured(f);
          }}
        />
        <button
          className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
          onClick={onCancel}
        >
          Go back
        </button>
      </div>
    );
  }

  if (stage === "review" && result) {
    return (
      <div className="space-y-5">
        <h2>How does this look?</h2>
        <p>
          {result.straightened
            ? "We found the page and straightened it for you."
            : "We couldn't find the edges of the page, so here's your photo as it was taken. That's perfectly fine to send — your accountant can read it."}
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
        <img
          src={result.shot.url}
          alt="Preview of the captured page"
          className="max-h-96 w-full rounded-lg border border-slate-300 object-contain bg-white"
        />
        <button
          className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a]"
          onClick={confirm}
        >
          Looks good — use this photo
        </button>
        {result.straightened && snapshot && (
          <button
            className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
            onClick={() => setResult({ shot: snapshot, straightened: false })}
          >
            Show the original photo instead
          </button>
        )}
        <button
          className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
          onClick={retake}
        >
          Take it again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2>Take a photo</h2>
      <p>
        Lay the paper on a surface darker than the page, and hold your phone so the whole sheet
        fits with a small gap around it.
      </p>
      <div className="relative">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full rounded-lg border border-slate-300 bg-black"
          aria-label="Camera preview"
        />
        <canvas ref={overlayRef} aria-hidden className="absolute inset-0 h-full w-full" />
      </div>
      <p
        role="status"
        className={
          detected ? "font-semibold text-[#00703c]" : "font-semibold text-slate-700"
        }
      >
        {stage !== "live"
          ? "Starting the camera…"
          : detected
            ? "We can see the page — hold steady and take the photo."
            : "Looking for the page… move back a little so all four corners show."}
      </p>
      <button
        className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a] disabled:opacity-60"
        onClick={snap}
        disabled={stage !== "live"}
      >
        Take the photo
      </button>
      <button
        className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
        onClick={onCancel}
      >
        Go back
      </button>
    </div>
  );
}
