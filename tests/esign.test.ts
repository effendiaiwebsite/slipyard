import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OrgScope } from "@/db/scoped";
import { can, type Actor } from "@/lib/permissions";
import { appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M6 e-signature: the pure PDF helpers (CRA timestamp, hashing, stamping +
 * immutability), the mark decoder, and the DB-backed orchestration (send
 * advances the engagement by category, execute writes a NEW immutable signed
 * doc), plus RLS isolation on signature_request.
 *
 * Storage is mocked (no S3): getObjectBuffer returns the in-memory source PDF,
 * putObject is a no-op — mirrors documents.test.ts.
 */

let mockSourcePdf: Buffer;
let mockPutCalls: { key: string; size: number }[] = [];

vi.mock("@/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...real,
    getObjectBuffer: vi.fn(async () => mockSourcePdf),
    putObject: vi.fn(async (key: string, body: Buffer) => {
      mockPutCalls.push({ key, size: body.byteLength });
    }),
    presignDownloadUrl: vi.fn(async () => "https://example.test/signed"),
    presignInlineUrl: vi.fn(async () => "https://example.test/inline"),
  };
});

import {
  advanceEngagementForSignature,
  decodeSignatureMark,
  executeSignatureRequest,
  sendSignatureRequest,
} from "@/lib/esign";
import { formatCraTimestamp, hashBytes, readPdfPageSizes, stampSignature } from "@/lib/pdf";

// 1x1 red PNG.
const RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function makePdf(pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 12, font });
  }
  return Buffer.from(await pdf.save());
}

describe("CRA timestamp format", () => {
  const d = new Date("2026-03-15T18:30:45Z");

  it("formats YYYY/MM/DD HH:MM:SS in the org timezone", () => {
    // Toronto is EDT (UTC-4) on 2026-03-15.
    expect(formatCraTimestamp(d, "America/Toronto")).toBe("2026/03/15 14:30:45");
    expect(formatCraTimestamp(d, "UTC")).toBe("2026/03/15 18:30:45");
  });

  it("uses 24-hour time and zero-pads", () => {
    const morning = new Date("2026-01-05T02:07:09Z");
    expect(formatCraTimestamp(morning, "UTC")).toBe("2026/01/05 02:07:09");
  });
});

describe("hashBytes", () => {
  it("is a stable sha256 hex", () => {
    expect(hashBytes(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });
});

describe("decodeSignatureMark", () => {
  it("passes a typed name through", () => {
    expect(decodeSignatureMark({ method: "typed", name: "Ada L" })).toEqual({
      method: "typed",
      name: "Ada L",
    });
  });

  it("decodes a valid PNG data URL", () => {
    const mark = decodeSignatureMark({
      method: "drawn",
      png: `data:image/png;base64,${RED_PNG_B64}`,
    });
    expect(mark?.method).toBe("drawn");
    expect((mark as { png: Buffer }).png[0]).toBe(0x89);
  });

  it("rejects non-PNG bytes", () => {
    const notPng = Buffer.from("hello world").toString("base64");
    expect(decodeSignatureMark({ method: "drawn", png: notPng })).toBeNull();
  });
});

describe("stampSignature", () => {
  it("appends an audit page and never mutates the source", async () => {
    const source = await makePdf(2);
    const sourceHashBefore = hashBytes(source);

    const executed = await stampSignature({
      source,
      placements: [
        { id: "s1", page: 0, xPct: 0.1, yPct: 0.8, wPct: 0.3, hPct: 0.06, kind: "signature" },
        { id: "d1", page: 1, xPct: 0.6, yPct: 0.8, wPct: 0.2, hPct: 0.035, kind: "date" },
      ],
      mark: { method: "drawn", png: Buffer.from(RED_PNG_B64, "base64") },
      timestampText: "2026/03/15 14:30:45",
      audit: {
        title: "T183",
        signerName: "Ruth Okafor",
        signedVia: "portal",
        method: "drawn",
        timestampText: "2026/03/15 14:30:45",
        timezone: "America/Toronto",
        ip: "1.2.3.4",
        tokenId: "tok-1",
        sourceHash: sourceHashBefore,
        requestId: "req-1",
        firmName: "Lakeside CPA",
      },
    });

    // Source buffer is untouched (immutability).
    expect(hashBytes(source)).toBe(sourceHashBefore);
    // Executed = source pages + 1 audit page.
    const outPages = await readPdfPageSizes(Buffer.from(executed));
    expect(outPages).toHaveLength(3);
    // It's a real, loadable PDF.
    await expect(PDFDocument.load(executed)).resolves.toBeTruthy();
  });

  it("works with a typed signature", async () => {
    const source = await makePdf(1);
    const executed = await stampSignature({
      source,
      placements: [
        { id: "s1", page: 0, xPct: 0.1, yPct: 0.8, wPct: 0.3, hPct: 0.06, kind: "signature" },
        { id: "i1", page: 0, xPct: 0.5, yPct: 0.8, wPct: 0.1, hPct: 0.05, kind: "initials" },
      ],
      mark: { method: "typed", name: "Ruth Okafor" },
      timestampText: "2026/03/15 14:30:45",
      audit: {
        title: "T183",
        signerName: "Ruth Okafor",
        signedVia: "in_person",
        method: "typed",
        timestampText: "2026/03/15 14:30:45",
        timezone: "America/Toronto",
        operatorName: "Sam Lee",
        sourceHash: "abc",
        requestId: "req-2",
        firmName: "Lakeside CPA",
      },
    });
    expect((await readPdfPageSizes(Buffer.from(executed))).length).toBe(2);
  });
});

// ---- DB-backed orchestration + RLS ------------------------------------------

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let clientA: string;
let docA: string;
let engA: string;
let sigStageId: string;
let firstStageId: string;

beforeAll(async () => {
  mockSourcePdf = await makePdf(1);
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);

  const { DEFAULT_ENGAGEMENT_STAGES } = await import("@/db/schema");
  const stageIds: Record<string, string> = {};
  for (const s of DEFAULT_ENGAGEMENT_STAGES) {
    const row = await scopeA.createStage({ key: s.key, label: s.label, category: s.category });
    stageIds[s.key] = row.id;
  }
  const stages = await scopeA.listStages();
  firstStageId = stages.find((s) => s.category === "not_started")!.id;
  sigStageId = stages.find((s) => s.category === "awaiting_signature")!.id;

  const client = await scopeA.createClient({
    type: "individual",
    displayName: "Ruth Okafor",
    email: "ruth@example.test",
    assignedAccountantId: f.userA,
    createdBy: f.userA,
  });
  clientA = client.id;

  const eng = await scopeA.createEngagement({
    clientId: clientA,
    type: "t1",
    taxYear: 2025,
    stageId: firstStageId,
    assignedToId: f.userA,
  });
  engA = eng.id;

  const doc = await scopeA.createDocument({
    clientId: clientA,
    engagementId: engA,
    filename: "letter.pdf",
    contentType: "application/pdf",
    sizeBytes: mockSourcePdf.byteLength,
    s3Key: `org/${f.orgA}/vault/x/letter.pdf`,
    status: "clean",
    source: "staff_upload",
  });
  docA = doc.id;
});

afterAll(async () => {
  await destroyFixture(f);
  const { pool } = await import("@/db");
  await pool.end();
});

async function freshRequest(placements = 1) {
  return scopeA.createSignatureRequest({
    clientId: clientA,
    documentId: docA,
    engagementId: engA,
    title: "Engagement letter",
    mode: "remote",
    signerName: "Ruth Okafor",
    signerEmail: "ruth@example.test",
    placements:
      placements > 0
        ? [{ id: "s1", page: 0, xPct: 0.1, yPct: 0.8, wPct: 0.3, hPct: 0.06, kind: "signature" }]
        : [],
    createdBy: f.userA,
  });
}

describe("send advances the engagement by category (ADR-0027)", () => {
  it("moves a not_started engagement to the awaiting_signature stage", async () => {
    await scopeA.transitionEngagement(engA, firstStageId);
    const request = await freshRequest();
    const client = await scopeA.getClient(clientA);

    await sendSignatureRequest(scopeA, request, client!);

    const eng = await scopeA.getEngagement(engA);
    expect(eng!.stageId).toBe(sigStageId);
    const updated = await scopeA.getSignatureRequest(request.id);
    expect(updated!.status).toBe("sent");
    expect(updated!.sentAt).toBeTruthy();
  });

  it("does not drag an already-filed engagement backwards", async () => {
    const stages = await scopeA.listStages();
    const filedStage = stages.find((s) => s.category === "filed")!;
    await scopeA.transitionEngagement(engA, filedStage.id);

    await advanceEngagementForSignature(scopeA, engA);
    const eng = await scopeA.getEngagement(engA);
    expect(eng!.stageId).toBe(filedStage.id); // unchanged
  });
});

describe("executeSignatureRequest", () => {
  it("writes a NEW immutable signed document and marks the request signed", async () => {
    mockPutCalls = [];
    const request = await freshRequest();
    const client = await scopeA.getClient(clientA);

    const before = await scopeA.getDocument(docA);

    const updated = await executeSignatureRequest(scopeA, {
      request,
      client: client!,
      mark: { method: "typed", name: "Ruth Okafor" },
      signedVia: "portal",
      ip: "9.9.9.9",
      tokenId: "11111111-1111-4111-8111-111111111111",
    });

    expect(updated.status).toBe("signed");
    expect(updated.signedDocumentId).toBeTruthy();
    expect(updated.signedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(updated.signatureMethod).toBe("typed");
    expect(updated.signedVia).toBe("portal");

    // The source document is untouched (immutability).
    const after = await scopeA.getDocument(docA);
    expect(after!.s3Key).toBe(before!.s3Key);
    expect(after!.status).toBe("clean");

    // The executed PDF is a brand-new doc in the signed/ prefix.
    const signedDoc = await scopeA.getDocument(updated.signedDocumentId!);
    expect(signedDoc!.source).toBe("esign_executed");
    expect(signedDoc!.s3Key).toContain(`/signed/`);
    expect(signedDoc!.id).not.toBe(docA);
    expect(mockPutCalls.some((c) => c.key.includes("/signed/"))).toBe(true);
  });
});

describe("RLS + scoping", () => {
  it("org B cannot see org A's signature requests", async () => {
    const request = await freshRequest(0);
    expect(await scopeB.getSignatureRequest(request.id)).toBeNull();
    const bList = await scopeB.listSignatureRequests();
    expect(bList.find((r) => r.request.id === request.id)).toBeUndefined();
  });

  it("assigned-only scoping filters the list by client accountant", async () => {
    const all = await scopeA.listSignatureRequests();
    expect(all.length).toBeGreaterThan(0);
    const mine = await scopeA.listSignatureRequests({ assignedToId: f.userA });
    expect(mine.length).toBe(all.length); // clientA is assigned to userA
    const other = await scopeA.listSignatureRequests({ assignedToId: "someone-else" });
    expect(other.length).toBe(0);
  });
});

describe("permission matrix — signatures", () => {
  const actor = (role: Actor["role"]): Actor => ({ userId: "u1", orgId: "o1", role });
  const res = (assignedTo: string | null) => ({
    orgId: "o1",
    type: "signature_request",
    assignedTo,
  });

  it("accountant manages only assigned; clerk cannot manage but can view", () => {
    expect(can(actor("accountant"), "signatures.manage", res("u1"))).toBe(true);
    expect(can(actor("accountant"), "signatures.manage", res("u2"))).toBe(false);
    expect(can(actor("clerk"), "signatures.manage", res("u1"))).toBe(false);
    expect(can(actor("clerk"), "signatures.view")).toBe(true);
    expect(can(actor("owner"), "signatures.manage", res("u2"))).toBe(true);
  });
});
