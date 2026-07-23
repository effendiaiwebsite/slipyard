import "server-only";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { FieldPlacement } from "@/db/schema";

/**
 * PDF stamping for e-signature (M6, ADR-0024/0027). pdf-lib only — pure JS,
 * no native deps, no rasterizer. We never mutate the source object: stamping
 * loads the source bytes, overlays the signature/date fields, appends an
 * audit page, and returns a NEW byte array the caller stores separately.
 *
 * Coordinates: placements are fractions of the page with a TOP-LEFT origin
 * (ADR-0025, matches the browser). pdf-lib's origin is BOTTOM-LEFT — the
 * conversion happens here in one place.
 */

/** sha256 hex of a byte buffer — source/executed tamper evidence. */
export function hashBytes(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * CRA-required signing timestamp: `YYYY/MM/DD HH:MM:SS` in the org's
 * timezone (24-hour). Rendered onto date fields and the audit page.
 */
export function formatCraTimestamp(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  // hour12:false emits "24" at midnight in some ICU builds — normalise.
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return `${get("year")}/${get("month")}/${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}

/** Page geometry (PDF points) — feeds the aspect-true placement boxes. */
export async function readPdfPageSizes(bytes: Buffer): Promise<{ width: number; height: number }[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width, height };
  });
}

export type SignatureMark =
  | { method: "drawn"; png: Buffer }
  | { method: "typed"; name: string };

export type AuditInfo = {
  title: string;
  signerName: string;
  signerEmail?: string | null;
  signerPhone?: string | null;
  signedVia: "portal" | "in_person";
  method: "drawn" | "typed";
  timestampText: string; // CRA format, already formatted
  timezone: string;
  ip?: string | null;
  tokenId?: string | null; // remote: portal token id
  operatorName?: string | null; // in-person: staff operator
  sourceHash: string;
  requestId: string;
  firmName: string;
};

/**
 * Stamp the signer's mark into every placed field, render date fields with the
 * CRA timestamp, and append a one-page audit trail. Returns the executed PDF.
 * The source `bytes` are only read — never written back.
 */
export async function stampSignature(opts: {
  source: Buffer;
  placements: FieldPlacement[];
  mark: SignatureMark;
  timestampText: string;
  audit: AuditInfo;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(opts.source, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pages = pdf.getPages();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const pngImage = opts.mark.method === "drawn" ? await pdf.embedPng(opts.mark.png) : null;

  for (const f of opts.placements) {
    const page = pages[f.page];
    if (!page) continue; // placement points past the end (source changed) — skip safely
    const { width: pw, height: ph } = page.getSize();
    const boxW = f.wPct * pw;
    const boxH = f.hPct * ph;
    const boxX = f.xPct * pw;
    // Top-left origin → bottom-left: y is the box's BOTTOM edge in PDF coords.
    const boxY = ph - f.yPct * ph - boxH;

    if (f.kind === "date") {
      drawFittedText(page, opts.timestampText, helv, boxX, boxY, boxW, boxH);
      continue;
    }
    // signature / initials
    if (pngImage) {
      const scale = Math.min(boxW / pngImage.width, boxH / pngImage.height);
      const drawW = pngImage.width * scale;
      const drawH = pngImage.height * scale;
      page.drawImage(pngImage, {
        x: boxX + (boxW - drawW) / 2,
        y: boxY + (boxH - drawH) / 2,
        width: drawW,
        height: drawH,
      });
    } else if (opts.mark.method === "typed") {
      const text =
        f.kind === "initials" ? initials(opts.mark.name) : opts.mark.name;
      drawFittedText(page, text, italic, boxX, boxY, boxW, boxH);
    }
  }

  appendAuditPage(pdf, helv, helvBold, opts.audit);

  return pdf.save();
}

/** Draw text scaled to fit a box (height-driven, clamped to width). */
function drawFittedText(
  page: ReturnType<PDFDocument["getPages"]>[number],
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  x: number,
  y: number,
  w: number,
  h: number
) {
  let size = Math.min(h * 0.7, 24);
  // Shrink until it fits the width (min 6pt).
  while (size > 6 && font.widthOfTextAtSize(text, size) > w) size -= 0.5;
  const textH = font.heightAtSize(size);
  page.drawText(text, {
    x,
    y: y + (h - textH) / 2 + textH * 0.15,
    size,
    font,
    color: rgb(0.05, 0.05, 0.15),
  });
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || name.slice(0, 2).toUpperCase()
  );
}

/** Append the signature audit page (who/when/how/IP/hash). */
function appendAuditPage(
  pdf: PDFDocument,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  a: AuditInfo
) {
  const page = pdf.addPage([612, 792]); // US Letter
  const left = 56;
  let y = 720;

  page.drawText("Electronic signature certificate", {
    x: left,
    y,
    size: 18,
    font: bold,
    color: rgb(0.09, 0.13, 0.22),
  });
  y -= 14;
  page.drawLine({
    start: { x: left, y: y },
    end: { x: 556, y: y },
    thickness: 1,
    color: rgb(0.8, 0.82, 0.86),
  });
  y -= 30;

  const rows: [string, string][] = [
    ["Document", a.title],
    ["Signed by", a.signerName],
    ["Email", a.signerEmail || "—"],
    ["Phone", a.signerPhone || "—"],
    ["Signed at", `${a.timestampText} (${a.timezone})`],
    [
      "Signature method",
      a.method === "drawn" ? "Drawn on screen" : "Typed name",
    ],
    [
      "Authentication",
      a.signedVia === "portal"
        ? "Remote — client portal, verified by SMS one-time code"
        : "In person — on the firm's device",
    ],
    ["IP address", a.ip || "—"],
    a.signedVia === "portal"
      ? ["Portal token", a.tokenId || "—"]
      : ["Witnessed by", a.operatorName || "—"],
    ["Source document SHA-256", a.sourceHash],
    ["Request ID", a.requestId],
  ];

  for (const [label, value] of rows) {
    page.drawText(label.toUpperCase(), {
      x: left,
      y,
      size: 8,
      font: bold,
      color: rgb(0.45, 0.48, 0.55),
    });
    y -= 14;
    // Wrap long values (hashes/ids) across lines.
    for (const line of wrap(value, font, 11, 500)) {
      page.drawText(line, { x: left, y, size: 11, font, color: rgb(0.1, 0.12, 0.18) });
      y -= 16;
    }
    y -= 8;
  }

  y = Math.max(y, 70);
  page.drawText(
    `Generated by ${a.firmName} via SlipYard. This certificate accompanies the signed document above.`,
    { x: left, y: 56, size: 8, font, color: rgb(0.5, 0.52, 0.58), maxWidth: 500 }
  );
}

/** Greedy word-wrap; falls back to hard character breaks for long tokens. */
function wrap(
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  const pushWord = (w: string) => {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      cur = test;
      return;
    }
    if (cur) lines.push(cur);
    // The word itself may exceed the width (a sha256): hard-break it.
    if (font.widthOfTextAtSize(w, size) <= maxWidth) {
      cur = w;
    } else {
      let chunk = "";
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      cur = chunk;
    }
  };
  for (const w of words) pushWord(w);
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
