"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * jscanify document capture (M4): live camera preview → snap → detect the
 * paper with OpenCV.js → show the straightened (perspective-corrected)
 * result → confirm. Both libraries load lazily from /public/vendor (copied
 * from node_modules on postinstall) so nothing crosses the same-origin CSP;
 * OpenCV's WASM needs the deliberate 'wasm-unsafe-eval' + worker-src
 * additions in next.config.ts.
 *
 * Every failure path (no camera, permission denied, OpenCV won't load, no
 * paper detected) falls back to the device's native camera file input —
 * the flow never dead-ends.
 */

declare global {
  interface Window {
    cv?: { onRuntimeInitialized?: () => void; Mat?: unknown };
    jscanify?: new () => {
      extractPaper: (
        image: HTMLCanvasElement,
        width: number,
        height: number
      ) => HTMLCanvasElement | null;
    };
  }
}

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
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("starting");
  const [snapshot, setSnapshot] = useState<Shot | null>(null);
  const [result, setResult] = useState<{ shot: Shot; straightened: boolean } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Camera + vendor libraries spin up together; any failure → native input.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stream] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1920 } },
            audio: false,
          }),
          loadVendor(),
        ]);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
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
  }, [stopStream]);

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const frame = document.createElement("canvas");
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    frame.getContext("2d")!.drawImage(video, 0, 0);
    stopStream();
    const original = toShot(frame);
    setSnapshot(original);

    let extracted: HTMLCanvasElement | null = null;
    try {
      const scanner = new window.jscanify!();
      // Letter-page proportions at a resolution that keeps text readable.
      extracted = scanner.extractPaper(frame, 1275, 1650);
    } catch {
      extracted = null;
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
    setStage("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
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
            : "We couldn't find the page edges, so here's your photo as-is."}
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
      <p>Lay the paper flat with all four corners in view, then press the button.</p>
      <video
        ref={videoRef}
        playsInline
        muted
        className="w-full rounded-lg border border-slate-300 bg-black"
        aria-label="Camera preview"
      />
      <button
        className="w-full rounded-lg bg-[#26374a] px-6 py-4 text-xl font-bold text-white hover:bg-[#1c2b3a] disabled:opacity-60"
        onClick={snap}
        disabled={stage !== "live"}
      >
        {stage === "live" ? "Take the photo" : "Starting the camera…"}
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
