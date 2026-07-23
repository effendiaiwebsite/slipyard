import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import { pool } from "@/db";
import { createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M10 dashboard wiring: the "Documents outstanding" count (missing REQUIRED
 * checklist items, firm-wide vs one assignee) and the front-desk recent
 * portal uploads list. Both org-scoped.
 */

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let clientA: string;
let clientB: string;
let stageA: string;
let stageB: string;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);

  stageA = (
    await scopeA.createStage({ key: "not_started", label: "Not started", category: "not_started" })
  ).id;
  stageB = (
    await scopeB.createStage({ key: "not_started", label: "Not started", category: "not_started" })
  ).id;

  clientA = (
    await scopeA.createClient({
      displayName: "Dash Client A",
      type: "individual",
      preferredChannel: "phone",
      createdBy: f.userA,
    })
  ).id;
  clientB = (
    await scopeB.createClient({
      displayName: "Dash Client B",
      type: "individual",
      preferredChannel: "phone",
      createdBy: f.userB,
    })
  ).id;
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

describe("countMissingRequiredDocuments", () => {
  it("counts missing required items only, with assignee scoping and isolation", async () => {
    // Engagement 1 — assigned to userA: 2 missing required, 1 missing
    // optional, 1 received required. Only the 2 count.
    const e1 = await scopeA.createEngagement({
      clientId: clientA,
      type: "t1",
      taxYear: 2025,
      stageId: stageA,
      assignedToId: f.userA,
    });
    await scopeA.createChecklistItems(e1.id, [
      { title: "T4 slip", required: true, position: 0 },
      { title: "RRSP receipt", required: true, position: 1 },
      { title: "Donation receipts", required: false, position: 2 },
      { title: "Prior NOA", required: true, position: 3 },
    ]);
    const received = (await scopeA.listChecklistItems(e1.id)).find(
      (i) => i.title === "Prior NOA"
    )!;
    await scopeA.updateChecklistItem(received.id, { status: "received" });

    // Engagement 2 — unassigned: 1 missing required.
    const e2 = await scopeA.createEngagement({
      clientId: clientA,
      type: "t1",
      taxYear: 2024,
      stageId: stageA,
    });
    await scopeA.createChecklistItems(e2.id, [
      { title: "T5 slip", required: true, position: 0 },
    ]);

    // Org B noise — must never leak into org A counts.
    const eB = await scopeB.createEngagement({
      clientId: clientB,
      type: "t1",
      taxYear: 2025,
      stageId: stageB,
    });
    await scopeB.createChecklistItems(eB.id, [
      { title: "Org B slip", required: true, position: 0 },
    ]);

    const firmWide = await scopeA.countMissingRequiredDocuments();
    expect(firmWide).toEqual({ items: 3, engagements: 2 });

    const mine = await scopeA.countMissingRequiredDocuments(f.userA);
    expect(mine).toEqual({ items: 2, engagements: 1 });

    const nobody = await scopeA.countMissingRequiredDocuments(f.userB);
    expect(nobody).toEqual({ items: 0, engagements: 0 });

    expect(await scopeB.countMissingRequiredDocuments()).toEqual({
      items: 1,
      engagements: 1,
    });
  });
});

describe("listRecentPortalUploads", () => {
  it("returns portal-sourced documents only, newest first, org-scoped", async () => {
    await scopeA.createDocument({
      clientId: clientA,
      filename: "staff-upload.pdf",
      contentType: "application/pdf",
      sizeBytes: 100,
      s3Key: `org/${f.orgA}/vault/staff-upload.pdf`,
      status: "clean",
      source: "staff_upload",
    });
    const older = await scopeA.createDocument({
      clientId: clientA,
      filename: "portal-older.jpg",
      contentType: "image/jpeg",
      sizeBytes: 100,
      s3Key: `org/${f.orgA}/vault/portal-older.jpg`,
      status: "clean",
      source: "portal_upload",
    });
    const newer = await scopeA.createDocument({
      clientId: clientA,
      filename: "portal-newer.jpg",
      contentType: "image/jpeg",
      sizeBytes: 100,
      s3Key: `org/${f.orgA}/vault/portal-newer.jpg`,
      status: "pending_scan",
      source: "portal_upload",
    });
    await scopeB.createDocument({
      clientId: clientB,
      filename: "org-b-portal.jpg",
      contentType: "image/jpeg",
      sizeBytes: 100,
      s3Key: `org/${f.orgB}/vault/org-b-portal.jpg`,
      status: "clean",
      source: "portal_upload",
    });

    const rows = await scopeA.listRecentPortalUploads(8);
    expect(rows.map((r) => r.document.id)).toEqual([newer.id, older.id]);
    expect(rows.every((r) => r.document.source === "portal_upload")).toBe(true);
    expect(rows[0].clientName).toBe("Dash Client A");

    // limit respected
    expect(await scopeA.listRecentPortalUploads(1)).toHaveLength(1);
  });
});
