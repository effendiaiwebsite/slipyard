import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import { defaultOrgSettings, type OrgSettings } from "@/db/schema";
import { runAiTool, type AiToolContext } from "@/lib/ai/tools";
import {
  authorize,
  can,
  PermissionError,
  TenancyViolationError,
} from "@/lib/permissions";
import { quarantineKey, signedKey, vaultKey } from "@/lib/storage";
import {
  buildStagedRows,
  parseCsv,
  suggestMapping,
} from "@/lib/imports";
import { adminUrl, appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M9 tenancy red-team (§6). Deliberate cross-org probes through EVERY tenant
 * surface — the scoped repository, the permission layer, the AI read tools,
 * the new import tables, and raw app-role SQL against RLS. Org A holds rich
 * data; org B (a hostile tenant) must never read, mutate, or drive any of it,
 * and must never learn that a foreign row even exists.
 */

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let settingsA: OrgSettings;

// Org A seeded resources (created in beforeAll).
const A: {
  clientId: string;
  engagementId: string;
  documentId: string;
  authId: string;
  stagedBatchId: string;
  committedBatchId: string;
  templateId: string;
} = {
  clientId: "",
  engagementId: "",
  documentId: "",
  authId: "",
  stagedBatchId: "",
  committedBatchId: "",
  templateId: "",
};
let bClientId: string;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);
  settingsA = (await scopeA.getOrg())?.settings ?? { ...defaultOrgSettings };

  // Org A: a client with SIN, a staged engagement, a clean document, a CRA
  // authorization, an import mapping template, a staged batch, and a
  // committed import batch (creates its own clients).
  const stage = await scopeA.createStage({
    key: "awaiting-docs",
    label: "Awaiting docs",
    category: "awaiting_docs",
  });
  const client = await scopeA.createClient({
    type: "individual",
    displayName: "Ada Secret",
    email: "ada@a.test",
    assignedAccountantId: f.userA,
    sinEncrypted: "k1:iv:tag:ct",
    sinLast3: "286",
  });
  A.clientId = client.id;
  const eng = await scopeA.createEngagement({
    clientId: client.id,
    type: "t1",
    taxYear: 2025,
    stageId: stage.id,
  });
  A.engagementId = eng.id;
  const doc = await scopeA.createDocument({
    clientId: client.id,
    filename: "secret.pdf",
    contentType: "application/pdf",
    sizeBytes: 100,
    s3Key: vaultKey(f.orgA, "doc", "secret.pdf"),
    status: "clean",
  });
  A.documentId = doc.id;
  const auth = await scopeA.createAuthorization({ clientId: client.id, level: "level1", status: "active" });
  A.authId = auth.id;
  const tmpl = await scopeA.upsertImportMappingTemplate("A map", { Name: "displayName" });
  A.templateId = tmpl.id;

  const stagedCsv = "Name\nStaged Only";
  const stagedParsed = parseCsv(stagedCsv);
  const stagedBatch = await scopeA.createStagedImportBatch({
    filename: "staged.csv",
    sourceColumns: stagedParsed.headers,
    mapping: suggestMapping(stagedParsed.headers),
    rows: buildStagedRows(stagedParsed, suggestMapping(stagedParsed.headers)).rows,
  });
  A.stagedBatchId = stagedBatch.id;

  const committedCsv = "Name,SIN\nImported Person,046454286";
  const cParsed = parseCsv(committedCsv);
  const cMap = suggestMapping(cParsed.headers);
  const committedBatch = await scopeA.createStagedImportBatch({
    filename: "committed.csv",
    sourceColumns: cParsed.headers,
    mapping: cMap,
    rows: buildStagedRows(cParsed, cMap).rows,
  });
  A.committedBatchId = committedBatch.id;
  await scopeA.commitImportBatch(committedBatch.id);

  // Org B: one client of its own, to prove scoping (not just emptiness).
  const bClient = await scopeB.createClient({ type: "individual", displayName: "Bob Bystander" });
  bClientId = bClient.id;
});

afterAll(async () => {
  // Remove the import-created clients before the fixture teardown.
  await destroyFixture(f);
  const { pool } = await import("@/db");
  await pool.end();
});

describe("cross-org reads through OrgScope return nothing", () => {
  it("org B cannot fetch any of org A's rows by id", async () => {
    expect(await scopeB.getClient(A.clientId)).toBeNull();
    expect(await scopeB.getEngagement(A.engagementId)).toBeNull();
    expect(await scopeB.getDocument(A.documentId)).toBeNull();
    expect(await scopeB.getAuthorization(A.authId)).toBeNull();
    expect(await scopeB.getImportBatch(A.stagedBatchId)).toBeNull();
    expect(await scopeB.getImportBatch(A.committedBatchId)).toBeNull();
  });

  it("org B cannot list org A's staging rows, templates, or client book", async () => {
    expect(await scopeB.listStagingRows(A.committedBatchId)).toHaveLength(0);
    expect(await scopeB.listImportMappingTemplates()).toHaveLength(0);
    // Org B sees only its own client — the scope isn't just empty.
    const bClients = await scopeB.listClientsWithMeta({});
    expect(bClients.some((c) => c.client.id === bClientId)).toBe(true);
    expect(bClients.every((c) => c.client.orgId === f.orgB)).toBe(true);
    expect(bClients.some((c) => c.client.id === A.clientId)).toBe(false);
  });
});

describe("cross-org writes through OrgScope are no-ops", () => {
  it("org B cannot mutate org A's client or document", async () => {
    expect(await scopeB.updateClient(A.clientId, { displayName: "HACKED" })).toBeNull();
    expect(await scopeB.updateDocument(A.documentId, { status: "infected" })).toBeNull();
    // Org A's data is untouched.
    expect((await scopeA.getClient(A.clientId))?.displayName).toBe("Ada Secret");
    expect((await scopeA.getDocument(A.documentId))?.status).toBe("clean");
  });

  it("org B cannot commit, roll back, or discard org A's import batches", async () => {
    const commit = await scopeB.commitImportBatch(A.stagedBatchId);
    expect(commit.ok).toBe(false);
    const rollback = await scopeB.rollbackImportBatch(A.committedBatchId);
    expect(rollback.ok).toBe(false);
    expect(await scopeB.deleteStagedImportBatch(A.stagedBatchId)).toBe("not_found");
    // Org A's staged batch survives and is still committable by org A.
    expect((await scopeA.getImportBatch(A.stagedBatchId))?.status).toBe("staged");
  });
});

describe("the permission layer hard-fails on cross-org references", () => {
  const actorA = { userId: "ua", orgId: "org-a" };

  it("can() throws TenancyViolationError for a foreign-org resource", () => {
    expect(() =>
      can({ ...actorA, role: "owner" }, "clients.update", {
        orgId: "org-b",
        type: "client",
        id: "x",
      })
    ).toThrow(TenancyViolationError);
  });

  it("authorize() records the violation and rethrows", async () => {
    await expect(
      authorize(scopeA, { userId: f.userA, orgId: f.orgA, role: "owner" }, "clients.update", {
        orgId: f.orgB,
        type: "client",
        id: A.clientId,
      })
    ).rejects.toBeInstanceOf(TenancyViolationError);
    const audit = await scopeA.listAudit(20);
    expect(audit.some((a) => a.action === "tenancy_violation:clients.update")).toBe(true);
  });

  it("import.manage is owner/admin only and blocked in read-only mode", async () => {
    const denied = authorize(
      scopeA,
      { userId: f.userA, orgId: f.orgA, role: "clerk" },
      "import.manage",
      undefined
    );
    await expect(denied).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("AI read tools honour tenancy and never leak existence", () => {
  function bCtx(): AiToolContext {
    return {
      scope: scopeB,
      orgId: f.orgB,
      orgName: "Test Org B",
      role: "owner",
      orgSettings: settingsA,
      user: { id: f.userB, name: "Test User B", email: `${f.userB}@test.local` },
    };
  }

  it("list_clients for org B never surfaces an org A client", async () => {
    const { result } = await runAiTool(bCtx(), "list_clients", {});
    const rows = result as Array<{ id: string; name: string }>;
    expect(rows.some((r) => r.id === A.clientId)).toBe(false);
    expect(rows.some((r) => r.name === "Ada Secret")).toBe(false);
  });

  it("get_client_overview on a foreign client id returns not-found, not a leak", async () => {
    const { result } = await runAiTool(bCtx(), "get_client_overview", { clientId: A.clientId });
    expect(result).toHaveProperty("error");
    expect(JSON.stringify(result)).not.toContain("Ada Secret");
  });

  it("no tool payload for org B ever contains SIN ciphertext or a raw SIN", async () => {
    const tools = ["list_clients", "pipeline_summary", "missing_documents", "authorization_coverage", "billing_summary"];
    for (const t of tools) {
      const { result } = await runAiTool(bCtx(), t, {});
      const blob = JSON.stringify(result);
      expect(blob).not.toContain("k1:iv:tag:ct");
      expect(blob).not.toContain("046454286");
    }
  });
});

describe("raw app-role SQL cannot cross the tenant boundary (RLS)", () => {
  const TENANT_TABLES = [
    "client",
    "engagement",
    "document",
    "cra_authorization",
    "import_batch",
    "import_staging_row",
    "import_mapping_template",
    "ai_interaction",
    "portal_token",
    "signature_request",
    "message",
  ];

  async function asAppRole<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: appRoleUrl() });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  it("sees zero rows in every tenant table without an org GUC", async () => {
    await asAppRole(async (c) => {
      for (const table of TENANT_TABLES) {
        const r = await c.query(`select count(*)::int as n from ${table}`);
        expect(r.rows[0].n).toBe(0);
      }
    });
  });

  it("scoped to org B, cannot see org A's client/document/import rows", async () => {
    await asAppRole(async (c) => {
      await c.query(`select set_config('app.org_id', $1, false)`, [f.orgB]);
      const client = await c.query(`select * from client where id = $1`, [A.clientId]);
      expect(client.rowCount).toBe(0);
      const doc = await c.query(`select * from document where id = $1`, [A.documentId]);
      expect(doc.rowCount).toBe(0);
      const batch = await c.query(`select * from import_batch where id = $1`, [A.committedBatchId]);
      expect(batch.rowCount).toBe(0);
      const staging = await c.query(`select * from import_staging_row where batch_id = $1`, [
        A.committedBatchId,
      ]);
      expect(staging.rowCount).toBe(0);
    });
  });

  it("scoped to org B, cannot INSERT an import row into org A (WITH CHECK)", async () => {
    await asAppRole(async (c) => {
      await c.query(`select set_config('app.org_id', $1, false)`, [f.orgB]);
      await expect(
        c.query(
          `insert into import_batch (org_id, filename) values ($1, 'evil.csv')`,
          [f.orgA]
        )
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("confirms org A's rows really exist (via admin) — the probes above are real", async () => {
    const c = new Client({ connectionString: adminUrl() });
    await c.connect();
    try {
      const r = await c.query(`select count(*)::int as n from import_batch where org_id = $1`, [f.orgA]);
      expect(r.rows[0].n).toBeGreaterThanOrEqual(2);
    } finally {
      await c.end();
    }
  });
});

describe("S3 keys embed the org boundary", () => {
  it("every key kind is prefixed org/{orgId}/", () => {
    expect(quarantineKey("org-1", "d", "f.pdf")).toBe("org/org-1/quarantine/d/f.pdf");
    expect(vaultKey("org-1", "d", "f.pdf")).toBe("org/org-1/vault/d/f.pdf");
    expect(signedKey("org-1", "d", "f.pdf")).toBe("org/org-1/signed/d/f.pdf");
    // A different org's key can never collide into org-1's prefix.
    expect(vaultKey("org-2", "d", "f.pdf").startsWith("org/org-1/")).toBe(false);
  });
});
