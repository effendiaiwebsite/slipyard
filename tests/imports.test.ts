import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgScope } from "@/db/scoped";
import { pool } from "@/db";
import {
  buildStagedRows,
  parseCsv,
  suggestMapping,
  SAMPLE_IMPORT_CSV,
  CUSTOM_PREFIX,
} from "@/lib/imports";
import { decryptField } from "@/lib/crypto";
import { allowedInReadOnly, can, type Role } from "@/lib/permissions";
import { appRoleUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M9 generic import (ADR-0033). Two layers: the pure parse/map/validate core
 * (SIN never surfaces as plaintext), and the OrgScope commit/rollback path
 * (atomic create, dependency-guarded rollback, tenant isolation).
 */

let f: Fixture;

beforeAll(async () => {
  f = await createFixture();
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

describe("CSV parsing", () => {
  it("detects the delimiter and reads a header + rows", () => {
    const p = parseCsv("name,email\nAda,ada@x.io\nBo,bo@x.io\n");
    expect(p.delimiter).toBe(",");
    expect(p.headers).toEqual(["name", "email"]);
    expect(p.rows).toHaveLength(2);
  });

  it("handles quoted fields with embedded commas and newlines", () => {
    const p = parseCsv('name,note\n"Smith, John","line one\nline two"\n');
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0][0]).toBe("Smith, John");
    expect(p.rows[0][1]).toBe("line one\nline two");
  });

  it("auto-detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2").delimiter).toBe(";");
    expect(parseCsv("a\tb\n1\t2").delimiter).toBe("\t");
  });

  it("drops fully-blank rows and warns on an empty body", () => {
    expect(parseCsv("name\n\n\n").warnings.join(" ")).toMatch(/no data rows/i);
  });
});

describe("mapping suggestion", () => {
  it("maps known headers to targets and unknowns to custom fields", () => {
    const m = suggestMapping(["Full Name", "E-mail", "Referral Source"]);
    expect(m["Full Name"]).toBe("displayName");
    expect(m["E-mail"]).toBe("email");
    expect(m["Referral Source"]).toBe(`${CUSTOM_PREFIX}Referral Source`);
  });
});

describe("row validation + SIN safety", () => {
  const parsed = parseCsv(SAMPLE_IMPORT_CSV);
  const mapping = suggestMapping(parsed.headers);
  const staged = buildStagedRows(parsed, mapping);

  it("creates named rows and skips the nameless one", () => {
    expect(staged.createCount).toBe(4);
    expect(staged.skipCount).toBe(1);
    expect(staged.rows.find((r) => r.action === "skip")?.warnings.join(" ")).toMatch(/needs a name/i);
  });

  it("flags an invalid SIN, invalid email, and out-of-range date", () => {
    const tremblay = staged.rows.find((r) => r.mapped.displayName?.includes("Tremblay"))!;
    expect(tremblay.warnings.join(" ")).toMatch(/SIN is not a valid/i);
    expect(tremblay.warnings.join(" ")).toMatch(/Email .* doesn't look valid/i);
    expect(tremblay.mapped.email).toBeNull();
    expect(tremblay.mapped.sinEncrypted).toBeNull();
    const nadia = staged.rows.find((r) => r.mapped.displayName === "Nadia Rahman")!;
    expect(nadia.warnings.join(" ")).toMatch(/date of birth .* out of range/i);
    expect(nadia.mapped.dateOfBirth).toBeNull();
  });

  it("blanks dates that don't exist on the calendar (Feb 31) but keeps real leap days", () => {
    const p = parseCsv("Name,DOB\nOdd Data Example,31/02/1990\nLeap Day,29/02/2000\n");
    const s = buildStagedRows(p, suggestMapping(p.headers));
    const odd = s.rows.find((r) => r.mapped.displayName === "Odd Data Example")!;
    expect(odd.warnings.join(" ")).toMatch(/isn't a real calendar date/i);
    expect(odd.mapped.dateOfBirth).toBeNull();
    const leap = s.rows.find((r) => r.mapped.displayName === "Leap Day")!;
    expect(leap.warnings.join(" ")).toEqual(expect.not.stringMatching(/calendar/i));
    expect(leap.mapped.dateOfBirth).toBe("2000-02-29");
  });

  it("captures custom fields and normalises postal/phone/type", () => {
    const corp = staged.rows.find((r) => r.mapped.type === "corporation")!;
    expect(corp.mapped.postalCode).toBe("M4C 1B5");
    expect(corp.mapped.customFields["Referral Source"]).toBe("Referral");
    const ada = staged.rows.find((r) => r.mapped.displayName?.includes("Adaeze"))!;
    expect(ada.mapped.phone).toBe("+14165550182");
  });

  it("encrypts a valid SIN and NEVER exposes plaintext anywhere", () => {
    const ada = staged.rows.find((r) => r.mapped.displayName?.includes("Adaeze"))!;
    expect(ada.mapped.sinEncrypted).toBeTruthy();
    expect(ada.mapped.sinLast3).toBe("286");
    expect(decryptField(ada.mapped.sinEncrypted!)).toBe("046454286");
    // The masked raw cell must not carry the digits.
    expect(ada.raw["SIN"]).toBe("*** *** 286");
    // The entire staged payload (raw + mapped, all rows) must not contain a
    // plaintext SIN — the ciphertext is the only representation.
    const blob = JSON.stringify(staged.rows);
    expect(blob).not.toContain("046454286");
    expect(blob).not.toContain("123456789");
  });
});

describe("OrgScope commit + rollback", () => {
  const csv = "Name,Type,Email,Referral\nAda Lovelace,individual,ada@x.io,Web\nBo Diddley,individual,bo@x.io,Web";

  async function stageBatch(scope: OrgScope) {
    const parsed = parseCsv(csv);
    const mapping = suggestMapping(parsed.headers);
    const staged = buildStagedRows(parsed, mapping);
    return scope.createStagedImportBatch({
      filename: "test.csv",
      sourceColumns: parsed.headers,
      mapping,
      rows: staged.rows,
    });
  }

  it("stages, commits (creating clients + custom fields), and refuses a second commit", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    const batch = await stageBatch(scope);
    expect(batch.status).toBe("staged");
    expect(batch.rowCount).toBe(2);

    const res = await scope.commitImportBatch(batch.id);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.createdCount).toBe(2);

    const clients = await scope.listClientsWithMeta({ q: "Lovelace" });
    expect(clients).toHaveLength(1);
    const ada = await scope.getClient(clients[0].client.id);
    expect(ada?.customFields["Referral"]).toBe("Web");

    const again = await scope.commitImportBatch(batch.id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("not_staged");

    // Full rollback removes exactly the two created clients.
    const rb = await scope.rollbackImportBatch(batch.id);
    expect(rb.ok).toBe(true);
    if (rb.ok) {
      expect(rb.removed).toBe(2);
      expect(rb.status).toBe("rolled_back");
    }
    expect(await scope.listClientsWithMeta({ q: "Lovelace" })).toHaveLength(0);
  });

  it("keeps touched clients on rollback (partial) and removes untouched ones", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    const batch = await stageBatch(scope);
    await scope.commitImportBatch(batch.id);

    const bo = (await scope.listClientsWithMeta({ q: "Diddley" }))[0];
    // Touch Bo — a note makes the client a dependent-bearing row.
    await scope.addClientNote({ clientId: bo.client.id, body: "spoke with client" });

    const rb = await scope.rollbackImportBatch(batch.id);
    expect(rb.ok).toBe(true);
    if (rb.ok) {
      expect(rb.removed).toBe(1);
      expect(rb.status).toBe("partially_rolled_back");
      expect(rb.kept.map((k) => k.name)).toContain("Bo Diddley");
    }
    // Bo stays; Ada is gone.
    expect(await scope.listClientsWithMeta({ q: "Diddley" })).toHaveLength(1);
    expect(await scope.listClientsWithMeta({ q: "Lovelace" })).toHaveLength(0);

    // Clean up Bo so the fixture teardown is tidy.
    const boLeft = (await scope.listClientsWithMeta({ q: "Diddley" }))[0];
    await scope.updateClient(boLeft.client.id, { status: "archived" });
  });

  it("resolves assigned-accountant email to a staff id, and flags a no-match", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    const memberEmail = `${f.userA}@test.local`;
    const csv2 = `Name,Assigned Accountant\nZed Known,${memberEmail}\nYan Unknown,ghost@nowhere.test`;
    const parsed = parseCsv(csv2);
    const mapping = suggestMapping(parsed.headers);
    const staged = buildStagedRows(parsed, mapping);
    const batch = await scope.createStagedImportBatch({
      filename: "assign.csv",
      sourceColumns: parsed.headers,
      mapping,
      rows: staged.rows,
    });
    const res = await scope.commitImportBatch(batch.id);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.unresolvedAccountants).toBe(1);

    const zed = (await scope.listClientsWithMeta({ q: "Zed" }))[0];
    expect((await scope.getClient(zed.client.id))?.assignedAccountantId).toBe(f.userA);
    const yan = (await scope.listClientsWithMeta({ q: "Yan" }))[0];
    expect((await scope.getClient(yan.client.id))?.assignedAccountantId).toBeNull();

    await scope.rollbackImportBatch(batch.id);
  });
});

describe("tenant isolation", () => {
  it("org B cannot see org A's batch, staging rows, or templates", async () => {
    const scopeA = new OrgScope(f.orgA, f.userA);
    const parsed = parseCsv("Name\nSolo Client");
    const staged = buildStagedRows(parsed, suggestMapping(parsed.headers));
    const batch = await scopeA.createStagedImportBatch({
      filename: "iso.csv",
      sourceColumns: parsed.headers,
      mapping: suggestMapping(parsed.headers),
      rows: staged.rows,
    });
    await scopeA.upsertImportMappingTemplate("My Map", { Name: "displayName" });

    const scopeB = new OrgScope(f.orgB, f.userB);
    expect(await scopeB.getImportBatch(batch.id)).toBeNull();
    expect(await scopeB.listStagingRows(batch.id)).toHaveLength(0);
    expect(await scopeB.listImportMappingTemplates()).toHaveLength(0);

    await scopeA.deleteStagedImportBatch(batch.id);
  });

  it("raw app-role SQL sees no import rows without an org GUC", async () => {
    const c = new Client({ connectionString: appRoleUrl() });
    await c.connect();
    try {
      const b = await c.query("select * from import_batch");
      expect(b.rowCount).toBe(0);
      const s = await c.query("select * from import_staging_row");
      expect(s.rowCount).toBe(0);
    } finally {
      await c.end();
    }
  });
});

describe("import mapping templates", () => {
  it("upserts by name (replace), lists, and deletes", async () => {
    const scope = new OrgScope(f.orgA, f.userA);
    const t1 = await scope.upsertImportMappingTemplate("Firm map", { A: "displayName" });
    const t2 = await scope.upsertImportMappingTemplate("Firm map", { A: "email" });
    expect(t2.id).toBe(t1.id); // same row replaced
    expect(t2.mapping).toEqual({ A: "email" });
    const list = await scope.listImportMappingTemplates();
    expect(list.filter((t) => t.name === "Firm map")).toHaveLength(1);
    await scope.deleteImportMappingTemplate(t1.id);
    expect(
      (await scope.listImportMappingTemplates()).find((t) => t.name === "Firm map")
    ).toBeUndefined();
  });
});

describe("permission matrix", () => {
  const A = { userId: "u", orgId: "o" };
  it("only owner/admin may import; not allowed in read-only grace mode", () => {
    const grant = (role: Role) => can({ ...A, role }, "import.manage");
    expect(grant("owner")).toBe(true);
    expect(grant("admin")).toBe(true);
    expect(grant("accountant")).toBe(false);
    expect(grant("clerk")).toBe(false);
    expect(allowedInReadOnly("import.manage")).toBe(false);
  });
});
