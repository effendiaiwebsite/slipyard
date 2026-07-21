import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  can,
  TenancyViolationError,
  type Action,
  type Actor,
} from "@/lib/permissions";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

const actor = (role: Actor["role"]): Actor => ({ userId: "u1", orgId: ORG, role });
const res = (over: Partial<{ orgId: string; assignedTo: string | null }> = {}) => ({
  orgId: ORG,
  type: "client",
  id: "c1",
  assignedTo: null as string | null,
  ...over,
});

describe("permission matrix", () => {
  it("owner can do everything", () => {
    for (const action of ACTIONS) {
      expect(can(actor("owner"), action, res({ assignedTo: "someone-else" }))).toBe(true);
    }
  });

  it("admin: everything except billing and org deletion", () => {
    const a = actor("admin");
    expect(can(a, "billing.manage")).toBe(false);
    expect(can(a, "org.delete")).toBe(false);
    const rest = ACTIONS.filter((x): x is Action => x !== "billing.manage" && x !== "org.delete");
    for (const action of rest) {
      expect(can(a, action, res({ assignedTo: "someone-else" })), action).toBe(true);
    }
  });

  it("accountant: write assigned clients only, read the rest", () => {
    const a = actor("accountant");
    expect(can(a, "clients.view", res())).toBe(true);
    expect(can(a, "clients.update", res({ assignedTo: "u1" }))).toBe(true);
    expect(can(a, "clients.update", res({ assignedTo: "u2" }))).toBe(false);
    expect(can(a, "clients.update", res({ assignedTo: null }))).toBe(false);
    expect(can(a, "clients.export_sensitive", res({ assignedTo: "u2" }))).toBe(false);
    expect(can(a, "employees.invite")).toBe(false);
  });

  it("accountant view narrows under assigned_only org setting", () => {
    const a = actor("accountant");
    const settings = { ai_enabled: true, accountant_scope_mode: "assigned_only" as const };
    expect(can(a, "clients.view", res({ assignedTo: "u1" }), settings)).toBe(true);
    expect(can(a, "clients.view", res({ assignedTo: "u2" }), settings)).toBe(false);
  });

  it("clerk: read-only + intake + templated reminders; no edits or sensitive exports", () => {
    const c = actor("clerk");
    expect(can(c, "clients.view", res())).toBe(true);
    expect(can(c, "documents.intake_upload", res())).toBe(true);
    expect(can(c, "messages.send_templated", res())).toBe(true);
    expect(can(c, "clients.update", res({ assignedTo: "u1" }))).toBe(false);
    expect(can(c, "clients.create")).toBe(false);
    expect(can(c, "clients.export_sensitive", res())).toBe(false);
    expect(can(c, "engagements.transition", res({ assignedTo: "u1" }))).toBe(false);
  });

  it("cross-org resource is a hard error for every role, never a soft deny", () => {
    for (const role of ["owner", "admin", "accountant", "clerk"] as const) {
      expect(() => can(actor(role), "clients.view", res({ orgId: OTHER_ORG }))).toThrow(
        TenancyViolationError
      );
    }
  });
});
