"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * jscanify document capture (M4, quality pass M10). Live camera → continuous
 * page detection with an on-screen outline → snap (or auto-capture once the
 * outline holds steady) → perspective-corrected result → confirm, with
 * drag-the-corners adjustment when detection got it wrong. Both libraries
 * load lazily from /public/vendor (copied from node_modules on postinstall)
 * so nothing crosses the same-origin CSP; OpenCV's WASM needs the deliberate
 * 'wasm-unsafe-eval' + worker-src additions in next.config.ts.
 *
 * Real-device testing (2026-07-22) drove the original shape (live outline,
 * quality-gated quads, quad-derived output size); the M10 pass adds what the
 * customer asked for after that run:
 *  - Multi-strategy detection: jscanify's Canny+Otsu pass misses low-contrast
 *    scenes (white paper on a pale counter). When it finds nothing, a second
 *    pass — adaptive threshold → contours → largest 4-point polygon — runs on
 *    the same frame. Both feed the same quality gate.
 *  - Auto-capture: when the outline has held steady for ~1.2 s the shutter
 *    fires itself (on by default, one big checkbox to turn off). Elderly
 *    hands shake exactly when pressing the button.
 *  - Corner adjustment on review: drag four large handles onto the page
 *    corners and re-straighten (extractPaper accepts custom cornerPoints).
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

type CvMat = { delete: () => void; data32S?: Int32Array; rows?: number };
type CvMatVector = { size: () => number; get: (i: number) => CvMat; delete: () => void };

/** The slice of opencv.js we call directly (adaptive fallback, M10). */
type CvNamespace = {
  onRuntimeInitialized?: () => void;
  Mat?: new () => CvMat;
  MatVector?: new () => CvMatVector;
  Size?: new (w: number, h: number) => unknown;
  imread?: (el: HTMLCanvasElement) => CvMat;
  cvtColor?: (src: CvMat, dst: CvMat, code: number) => void;
  GaussianBlur?: (src: CvMat, dst: CvMat, ksize: unknown, sigmaX: number) => void;
  adaptiveThreshold?: (
    src: CvMat,
    dst: CvMat,
    maxValue: number,
    adaptiveMethod: number,
    thresholdType: number,
    blockSize: number,
    C: number
  ) => void;
  findContours?: (
    image: CvMat,
    contours: CvMatVector,
    hierarchy: CvMat,
    mode: number,
    method: number
  ) => void;
  contourArea?: (contour: CvMat) => number;
  arcLength?: (curve: CvMat, closed: boolean) => number;
  approxPolyDP?: (curve: CvMat, approx: CvMat, epsilon: number, closed: boolean) => void;
  COLOR_RGBA2GRAY?: number;
  ADAPTIVE_THRESH_GAUSSIAN_C?: number;
  THRESH_BINARY?: number;
  RETR_LIST?: number;
  CHAIN_APPROX_SIMPLE?: number;
};

declare global {
  interface Window {
    cv?: CvNamespace;
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
/** Auto-capture: corners may drift this many px (detect space) frame-to-frame… */
const STABLE_EPS_PX = 7;
/** …and must hold for this many detection frames (~1.2 s at 6 fps). */
const AUTO_CAPTURE_FRAMES = 7;

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

/** Classify four loose points into TL/TR/BR/BL by coordinate sums/diffs. */
function orderCorners(pts: Corner[]): Partial<Quad> {
  if (pts.length !== 4) return {};
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.x - a.y - (b.x - b.y));
  return {
    topLeftCorner: bySum[0],
    bottomRightCorner: bySum[3],
    bottomLeftCorner: byDiff[0],
    topRightCorner: byDiff[3],
  };
}

/**
 * Fallback strategy (M10): adaptive threshold → contours → largest 4-point
 * polygon. Catches low-contrast scenes (white page on a pale surface) where
 * jscanify's global Canny+Otsu pass finds nothing. Same manual Mat hygiene.
 */
function detectQuadAdaptive(canvas: HTMLCanvasElement): Quad | null {
  const cv = window.cv;
  if (
    !cv?.imread ||
    !cv.Mat ||
    !cv.MatVector ||
    !cv.Size ||
    !cv.cvtColor ||
    !cv.GaussianBlur ||
    !cv.adaptiveThreshold ||
    !cv.findContours ||
    !cv.contourArea ||
    !cv.arcLength ||
    !cv.approxPolyDP
  ) {
    return null;
  }

  let src: CvMat | null = null;
  let gray: CvMat | null = null;
  let thresh: CvMat | null = null;
  let contours: CvMatVector | null = null;
  let hierarchy: CvMat | null = null;
  try {
    src = cv.imread(canvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY ?? 11);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    thresh = new cv.Mat();
    cv.adaptiveThreshold(
      gray,
      thresh,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C ?? 1,
      cv.THRESH_BINARY ?? 0,
      21,
      5
    );
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(thresh, contours, hierarchy, cv.RETR_LIST ?? 1, cv.CHAIN_APPROX_SIMPLE ?? 2);

    const minArea = canvas.width * canvas.height * 0.06;
    let best: Corner[] | null = null;
    let bestArea = minArea;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = cv.contourArea(c);
        if (area <= bestArea) continue;
        const approx = new cv.Mat();
        try {
          cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
          const d = approx.data32S;
          if (approx.rows === 4 && d && d.length >= 8) {
            best = [
              { x: d[0], y: d[1] },
              { x: d[2], y: d[3] },
              { x: d[4], y: d[5] },
              { x: d[6], y: d[7] },
            ];
            bestArea = area;
          }
        } finally {
          approx.delete();
        }
      } finally {
        c.delete();
      }
    }
    return best ? qualifyQuad(orderCorners(best), canvas.width, canvas.height) : null;
  } catch {
    return null;
  } finally {
    hierarchy?.delete();
    contours?.delete();
    thresh?.delete();
    gray?.delete();
    src?.delete();
  }
}

/**
 * Detect the page in a canvas — jscanify's pass first, the adaptive fallback
 * when it comes up empty. Owns every Mat it creates — jscanify's own
 * highlightPaper leaks the contour, which a per-frame loop can't afford.
 */
function detectQuad(canvas: HTMLCanvasElement): Quad | null {
  const cv = window.cv;
  const Scanner = window.jscanify;
  if (!cv?.imread || !Scanner) return null;

  let img: CvMat | null = null;
  let contour: CvMat | null = null;
  let primary: Quad | null = null;
  try {
    img = cv.imread(canvas);
    const scanner = new Scanner();
    contour = scanner.findPaperContour(img);
    if (contour) {
      primary = qualifyQuad(scanner.getCornerPoints(contour), canvas.width, canvas.height);
    }
  } catch {
    primary = null;
  } finally {
    contour?.delete();
    img?.delete();
  }
  return primary ?? detectQuadAdaptive(canvas);
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

/** Frame-to-frame stability check for auto-capture. */
function quadIsSteady(a: Quad | null, b: Quad | null): boolean {
  if (!a || !b) return false;
  return (
    dist(a.topLeftCorner, b.topLeftCorner) <= STABLE_EPS_PX &&
    dist(a.topRightCorner, b.topRightCorner) <= STABLE_EPS_PX &&
    dist(a.bottomRightCorner, b.bottomRightCorner) <= STABLE_EPS_PX &&
    dist(a.bottomLeftCorner, b.bottomLeftCorner) <= STABLE_EPS_PX
  );
}

/** Straighten a full-res frame to the given quad (shared by snap + adjust). */
function extractToQuad(frame: HTMLCanvasElement, quad: Quad): HTMLCanvasElement | null {
  const Scanner = window.jscanify;
  if (!Scanner) return null;
  try {
    const w =
      (dist(quad.topLeftCorner, quad.topRightCorner) +
        dist(quad.bottomLeftCorner, quad.bottomRightCorner)) /
      2;
    const h =
      (dist(quad.topLeftCorner, quad.bottomLeftCorner) +
        dist(quad.topRightCorner, quad.bottomRightCorner)) /
      2;
    const shrink = Math.min(1, MAX_OUTPUT_EDGE / Math.max(w, h));
    return new Scanner().extractPaper(
      frame,
      Math.max(320, Math.round(w * shrink)),
      Math.max(320, Math.round(h * shrink)),
      quad
    );
  } catch {
    return null;
  }
}

type Stage = "starting" | "live" | "review" | "adjust" | "fallback";

/** A captured frame: the canvas (for encoding) plus a data URL (for display). */
type Shot = { canvas: HTMLCanvasElement; url: string };

function toShot(canvas: HTMLCanvasElement): Shot {
  return { canvas, url: canvas.toDataURL("image/jpeg", 0.85) };
}

const CORNER_KEYS = [
  "topLeftCorner",
  "topRightCorner",
  "bottomRightCorner",
  "bottomLeftCorner",
] as const;
type CornerKey = (typeof CORNER_KEYS)[number];

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
  /** Previous frame's quad + how long it has held still (auto-capture). */
  const lastQuadRef = useRef<Quad | null>(null);
  const stableFramesRef = useRef(0);
  const autoRef = useRef(true);
  const autoFiredRef = useRef(false);
  /** The snap-time quad in FULL-RES space — seeds the corner editor. */
  const fullQuadRef = useRef<Quad | null>(null);
  /** SVG overlay for the corner editor (pointer coords → image coords). */
  const adjustSvgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<CornerKey | null>(null);

  const [stage, setStage] = useState<Stage>("starting");
  const [detected, setDetected] = useState(false);
  const [steady, setSteady] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [snapshot, setSnapshot] = useState<Shot | null>(null);
  const [result, setResult] = useState<{ shot: Shot; straightened: boolean } | null>(null);
  const [adjustQuad, setAdjustQuad] = useState<Quad | null>(null);

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

  // Live detection loop: downscale → detect → outline (+ auto-capture once
  // the quad holds steady). Runs only while the preview is on screen.
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
      stableFramesRef.current = quadIsSteady(quad, lastQuadRef.current)
        ? stableFramesRef.current + 1
        : 0;
      lastQuadRef.current = quad;
      quadRef.current = quad;
      setDetected(!!quad);
      setSteady(stableFramesRef.current >= 2);

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

      if (
        autoRef.current &&
        !autoFiredRef.current &&
        quad &&
        stableFramesRef.current >= AUTO_CAPTURE_FRAMES
      ) {
        autoFiredRef.current = true;
        snap();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snap is stable per live render
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
      const quad = scaleQuad(previewQuad, frame.width / DETECT_WIDTH);
      fullQuadRef.current = quad;
      extracted = extractToQuad(frame, quad);
    } else {
      fullQuadRef.current = null;
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
    setAdjustQuad(null);
    quadRef.current = null;
    lastQuadRef.current = null;
    fullQuadRef.current = null;
    stableFramesRef.current = 0;
    autoFiredRef.current = false;
    setDetected(false);
    setSteady(false);
    setStage("starting");
    try {
      await startCamera();
      setStage("live");
    } catch {
      setStage("fallback");
    }
  }

  /** Open the corner editor seeded with the snap-time quad (or a margin box). */
  function startAdjust() {
    const frame = snapshot?.canvas;
    if (!frame) return;
    const inset = (fx: number, fy: number) => ({ x: frame.width * fx, y: frame.height * fy });
    setAdjustQuad(
      fullQuadRef.current ?? {
        topLeftCorner: inset(0.12, 0.12),
        topRightCorner: inset(0.88, 0.12),
        bottomRightCorner: inset(0.88, 0.88),
        bottomLeftCorner: inset(0.12, 0.88),
      }
    );
    setStage("adjust");
  }

  function applyAdjust() {
    const frame = snapshot?.canvas;
    if (!frame || !adjustQuad) return;
    fullQuadRef.current = adjustQuad;
    const extracted = extractToQuad(frame, adjustQuad);
    setResult(
      extracted
        ? { shot: toShot(extracted), straightened: true }
        : { shot: toShot(frame), straightened: false }
    );
    setStage("review");
  }

  /** Pointer position → snapshot pixel coords (the SVG shares its viewBox). */
  function toImageCoords(e: { clientX: number; clientY: number }): Corner | null {
    const svg = adjustSvgRef.current;
    const frame = snapshot?.canvas;
    if (!svg || !frame) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.min(frame.width, Math.max(0, ((e.clientX - rect.left) / rect.width) * frame.width)),
      y: Math.min(frame.height, Math.max(0, ((e.clientY - rect.top) / rect.height) * frame.height)),
    };
  }

  function onAdjustPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const p = toImageCoords(e);
    if (!p || !adjustQuad || !snapshot) return;
    // Grab the nearest corner — the whole surface is the touch target, so
    // shaky fingers don't have to land on the circle itself.
    let nearest: CornerKey = "topLeftCorner";
    let best = Infinity;
    for (const key of CORNER_KEYS) {
      const d = dist(p, adjustQuad[key]);
      if (d < best) {
        best = d;
        nearest = key;
      }
    }
    if (best > Math.max(snapshot.canvas.width, snapshot.canvas.height) * 0.25) return;
    draggingRef.current = nearest;
    adjustSvgRef.current?.setPointerCapture(e.pointerId);
    setAdjustQuad({ ...adjustQuad, [nearest]: p });
  }

  function onAdjustPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const key = draggingRef.current;
    if (!key) return;
    const p = toImageCoords(e);
    if (!p) return;
    setAdjustQuad((q) => (q ? { ...q, [key]: p } : q));
  }

  function onAdjustPointerUp() {
    draggingRef.current = null;
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

  if (stage === "adjust" && snapshot && adjustQuad) {
    const { canvas } = snapshot;
    const handleR = Math.max(canvas.width, canvas.height) * 0.028;
    const pts = CORNER_KEYS.map((k) => adjustQuad[k]);
    return (
      <div className="space-y-5">
        <h2>Adjust the corners</h2>
        <p>Drag each circle onto a corner of the page, then straighten.</p>
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          <img
            src={snapshot.url}
            alt="Your photo, ready for corner adjustment"
            className="w-full rounded-lg border border-slate-300 bg-white"
          />
          <svg
            ref={adjustSvgRef}
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            className="absolute inset-0 h-full w-full touch-none"
            role="application"
            aria-label="Corner adjustment — drag the circles onto the page corners"
            onPointerDown={onAdjustPointerDown}
            onPointerMove={onAdjustPointerMove}
            onPointerUp={onAdjustPointerUp}
            onPointerCancel={onAdjustPointerUp}
          >
            <polygon
              points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(0, 112, 60, 0.15)"
              stroke="#00703c"
              strokeWidth={Math.max(2, handleR / 5)}
            />
            {CORNER_KEYS.map((k) => (
              <circle
                key={k}
                cx={adjustQuad[k].x}
                cy={adjustQuad[k].y}
                r={handleR}
                fill="rgba(255,255,255,0.85)"
                stroke="#00703c"
                strokeWidth={Math.max(3, handleR / 4)}
              />
            ))}
          </svg>
        </div>
        <button
          className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a]"
          onClick={applyAdjust}
        >
          Straighten with these corners
        </button>
        <button
          className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
          onClick={() => setStage("review")}
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
        {snapshot && (
          <button
            className="w-full rounded-lg border-2 border-[#26374a] px-6 py-3 text-lg font-semibold text-[#26374a] hover:bg-slate-50"
            onClick={startAdjust}
          >
            Adjust the corners myself
          </button>
        )}
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
            ? autoCapture && steady
              ? "Hold still — taking the photo for you…"
              : "We can see the page — hold steady and take the photo."
            : "Looking for the page… move back a little so all four corners show."}
      </p>
      <label className="flex items-center gap-3 text-lg font-semibold text-[#26374a]">
        <input
          type="checkbox"
          checked={autoCapture}
          onChange={(e) => {
            setAutoCapture(e.target.checked);
            autoRef.current = e.target.checked;
            stableFramesRef.current = 0;
          }}
          className="h-6 w-6 accent-[#26374a]"
        />
        Take the photo for me when the page is steady
      </label>
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
