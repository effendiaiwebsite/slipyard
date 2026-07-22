import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OrgScope } from "@/db/scoped";
import { pool } from "@/db";
import { can, type Actor } from "@/lib/permissions";
import { appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M3 vault & checklists: template instantiation, category-keyed
 * auto-advance (ADR-0015), the scan→promote/flag pipeline (S3 + ClamAV
 * mocked), document permissions, and RLS on the new tables.
 */

// Keep real key helpers/classes; stub network-touching pieces.
vi.mock("@/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/storage")>();
  return {
    ...real,
    putObject: vi.fn(async () => {}),
    getObjectBuffer: vi.fn(async () => Buffer.from("bytes")),
    promoteToVault: vi.fn(async () => {}),
    deleteObject: vi.fn(async () => {}),
    presignDownloadUrl: vi.fn(async () => "https://example.test/presigned"),
  };
});
vi.mock("@/lib/clamav", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/clamav")>();
  return { ...real, scanBuffer: vi.fn() };
});

import { scanBuffer, ClamAvUnavailableError } from "@/lib/clamav";
import {
  applyAutoAdvance,
  CHECKLIST_TEMPLATES,
  instantiateChecklist,
} from "@/lib/checklists";
import { scanAndRouteDocument } from "@/lib/documents";
import { promoteToVault, sanitizeFilename } from "@/lib/storage";

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let clientA: string;
let stageIds: Record<string, string>;

const scanBufferMock = vi.mocked(scanBuffer);
const promoteMock = vi.mocked(promoteToVault);

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);

  stageIds = {};
  const { DEFAULT_ENGAGEMENT_STAGES } = await import("@/db/schema");
  for (const s of DEFAULT_ENGAGEMENT_STAGES) {
    const row = await scopeA.createStage({ key: s.key, label: s.label, category: s.category });
    stageIds[s.key] = row.id;
  }

  const created = await scopeA.createClient({
    displayName: "Vault Test Client",
    type: "individual",
    preferredChannel: "phone",
    assignedAccountantId: f.userA,
    createdBy: f.userA,
  });
  clientA = created.id;
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

beforeEach(() => {
  scanBufferMock.mockReset();
  promoteMock.mockClear();
});

async function makeEngagement(stageKey: string, type: "t1" | "t2" | "t3" | "other" = "t1") {
  const e = await scopeA.createEngagement({
    clientId: clientA,
    type,
    taxYear: 2025,
    stageId: stageIds[stageKey],
    assignedToId: f.userA,
  });
  return e.id;
}

describe("checklist templates", () => {
  it("instantiates the engagement type's template once, idempotently", async () => {
    const engagementId = await makeEngagement("not_started");
    const items = await instantiateChecklist(scopeA, engagementId, "t1");
    expect(items.length).toBe(CHECKLIST_TEMPLATES.t1.length);
    expect(items.filter((i) => i.required).length).toBe(
      CHECKLIST_TEMPLATES.t1.filter((t) => t.required).length
    );
    // Second call is a no-op returning the existing items.
    const again = await instantiateChecklist(scopeA, engagementId, "t1");
    expect(again.length).toBe(items.length);
    expect(await scopeA.listChecklistItems(engagementId)).toHaveLength(items.length);
  });

  it("'other' engagements start with an empty checklist", async () => {
    const engagementId = await makeEngagement("not_started", "other");
    const items = await instantiateChecklist(scopeA, engagementId, "other");
    expect(items).toHaveLength(0);
  });
});

describe("auto-advance (keyed on stage.category only)", () => {
  it("not_started + missing required items → first awaiting_docs stage", async () => {
    const engagementId = await makeEngagement("not_started");
    await instantiateChecklist(scopeA, engagementId, "t1");
    const res = await applyAutoAdvance(scopeA, engagementId);
    expect(res.moved && res.toCategory).toBe("awaiting_docs");
    const e = await scopeA.getEngagement(engagementId);
    expect(e?.stageId).toBe(stageIds.awaiting_docs);
    // Stamped under the stage KEY like any transition.
    expect(e?.statusTimestamps["awaiting_docs"]).toBeTruthy();
  });

  it("all required received/waived → first in_progress stage", async () => {
    const engagementId = await makeEngagement("not_started");
    await instantiateChecklist(scopeA, engagementId, "t1");
    await applyAutoAdvance(scopeA, engagementId); // → awaiting_docs
    const items = await scopeA.listChecklistItems(engagementId);
    for (const i of items.filter((i) => i.required)) {
      await scopeA.updateChecklistItem(i.id, { status: i.position % 2 ? "waived" : "received" });
    }
    const res = await applyAutoAdvance(scopeA, engagementId);
    expect(res.moved && res.toCategory).toBe("in_progress");
    const e = await scopeA.getEngagement(engagementId);
    // First in_progress stage in board order is in_preparation.
    expect(e?.stageId).toBe(stageIds.in_preparation);
  });

  it("never yanks an engagement already at in_progress or beyond", async () => {
    for (const key of ["in_review", "awaiting_signature", "filed"]) {
      const engagementId = await makeEngagement(key);
      await instantiateChecklist(scopeA, engagementId, "t1"); // required items missing
      const res = await applyAutoAdvance(scopeA, engagementId);
      expect(res.moved).toBe(false);
      const e = await scopeA.getEngagement(engagementId);
      expect(e?.stageId).toBe(stageIds[key]);
    }
  });

  it("no items → no movement (checklist not generated yet)", async () => {
    const engagementId = await makeEngagement("not_started", "other");
    const res = await applyAutoAdvance(scopeA, engagementId);
    expect(res.moved).toBe(false);
  });

  it("degrades to a no-op when the org's pipeline lacks the target category", async () => {
    // Org B's custom pipeline: no awaiting_docs stage at all.
    const intake = await scopeB.createStage({ key: "intake", label: "Intake", category: "not_started" });
    const work = await scopeB.createStage({ key: "work", label: "Work", category: "in_progress" });
    const cb = await scopeB.createClient({
      displayName: "Org B Client",
      type: "individual",
      preferredChannel: "phone",
      createdBy: f.userB,
    });
    const e = await scopeB.createEngagement({
      clientId: cb.id,
      type: "t1",
      taxYear: 2025,
      stageId: intake.id,
    });
    await instantiateChecklist(scopeB, e.id, "t1");

    // Missing required + no awaiting_docs category → stays put.
    const res1 = await applyAutoAdvance(scopeB, e.id);
    expect(res1.moved).toBe(false);
    expect((await scopeB.getEngagement(e.id))?.stageId).toBe(intake.id);

    // Satisfied checklist still finds in_progress.
    for (const i of await scopeB.listChecklistItems(e.id)) {
      await scopeB.updateChecklistItem(i.id, { status: "waived" });
    }
    const res2 = await applyAutoAdvance(scopeB, e.id);
    expect(res2.moved && res2.toStageId).toBe(work.id);
  });
});

describe("scan pipeline (S3 + ClamAV mocked)", () => {
  async function makeDoc() {
    return scopeA.createDocument({
      clientId: clientA,
      filename: "slip.pdf",
      contentType: "application/pdf",
      sizeBytes: 5,
      s3Key: `org/${f.orgA}/quarantine/x/slip.pdf`,
      uploadedBy: f.userA,
    });
  }

  it("clean verdict promotes to the vault key", async () => {
    scanBufferMock.mockResolvedValue({ verdict: "clean" });
    const doc = await makeDoc();
    const out = await scanAndRouteDocument(scopeA, doc, Buffer.from("x"));
    expect(out.status).toBe("clean");
    expect(out.s3Key).toBe(`org/${f.orgA}/vault/${doc.id}/slip.pdf`);
    expect(out.scannedAt).toBeTruthy();
    expect(promoteMock).toHaveBeenCalledOnce();
  });

  it("infected verdict flags the row and leaves it quarantined", async () => {
    scanBufferMock.mockResolvedValue({ verdict: "infected", signature: "Eicar-Test-Signature" });
    const doc = await makeDoc();
    const out = await scanAndRouteDocument(scopeA, doc, Buffer.from("x"));
    expect(out.status).toBe("infected");
    expect(out.scanResult).toBe("Eicar-Test-Signature");
    expect(out.s3Key).toContain("/quarantine/");
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it("scanner outage → scan_failed, never clean", async () => {
    scanBufferMock.mockRejectedValue(new ClamAvUnavailableError("connection refused"));
    const doc = await makeDoc();
    const out = await scanAndRouteDocument(scopeA, doc, Buffer.from("x"));
    expect(out.status).toBe("scan_failed");
    expect(promoteMock).not.toHaveBeenCalled();
  });
});

describe("document permissions", () => {
  const actor = (role: Actor["role"]): Actor => ({ userId: f.userA, orgId: f.orgA, role });

  it("clerks can intake-upload but never manage", () => {
    const res = { orgId: "", type: "document", assignedTo: null } as const;
    const clerkRes = { ...res, orgId: f.orgA };
    expect(can(actor("clerk"), "documents.intake_upload", clerkRes)).toBe(true);
    expect(can(actor("clerk"), "documents.view", clerkRes)).toBe(true);
    expect(can(actor("clerk"), "documents.manage", clerkRes)).toBe(false);
  });

  it("accountants manage only what's assigned to them", () => {
    const mine = { orgId: f.orgA, type: "engagement", assignedTo: f.userA };
    const theirs = { orgId: f.orgA, type: "engagement", assignedTo: f.userB };
    expect(can(actor("accountant"), "documents.manage", mine)).toBe(true);
    expect(can(actor("accountant"), "documents.manage", theirs)).toBe(false);
    expect(can(actor("owner"), "documents.manage", theirs)).toBe(true);
    expect(can(actor("admin"), "documents.manage", theirs)).toBe(true);
  });
});

describe("tenancy isolation (RLS + scoping)", () => {
  it("documents and checklist items never cross org scopes", async () => {
    const engagementId = await makeEngagement("not_started");
    await instantiateChecklist(scopeA, engagementId, "t1");
    const doc = await scopeA.createDocument({
      clientId: clientA,
      filename: "private.pdf",
      contentType: "application/pdf",
      sizeBytes: 3,
      s3Key: `org/${f.orgA}/quarantine/y/private.pdf`,
    });

    expect(await scopeB.getDocument(doc.id)).toBeNull();
    expect(await scopeB.listChecklistItems(engagementId)).toHaveLength(0);
    expect(await scopeB.listIntakeDocuments()).toHaveLength(0);
  });

  it("app role without a tenant GUC sees zero rows (FORCEd RLS)", async () => {
    const c = new Client({ connectionString: appRoleUrl() });
    await c.connect();
    try {
      const docs = await c.query("select count(*)::int as n from document");
      const items = await c.query("select count(*)::int as n from checklist_item");
      expect(docs.rows[0].n).toBe(0);
      expect(items.rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });
});

describe("filename sanitization", () => {
  it("strips paths, oddities, and dot-prefixes", () => {
    expect(sanitizeFilename("C:\\Users\\evil\\..\\..\\slip.pdf")).toBe("slip.pdf");
    expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("t4 (final) — copy?.pdf")).toBe("t4 _final_ _ copy_.pdf");
    expect(sanitizeFilename("")).toBe("document");
  });
});
