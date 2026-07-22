import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OrgScope } from "@/db/scoped";
import { pool } from "@/db";
import { can, type Actor } from "@/lib/permissions";
import {
  hashPortalToken,
  issueOtp,
  markOpenedAndSendOtp,
  mintPortalLink,
  PORTAL_LINK_OPENED_TTL_MS,
  PORTAL_OTP_MAX_ATTEMPTS,
  portalTokenProblem,
  validatePortalLink,
  verifyOtp,
} from "@/lib/portal-tokens";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { adminUrl, createFixture, destroyFixture, type Fixture } from "./helpers";

/**
 * M4 portal tokens: mint/validate lifecycle (7-day unopened, 15-minute
 * opened window), sha256-only storage (ADR-0003), the SMS OTP challenge
 * (durable 5-attempt cap), tenancy isolation on portal_token, and the
 * in-memory rate limiter. The OTP code is recovered from the outbox SMS
 * body — exactly what a real client sees.
 */

let f: Fixture;
let scopeA: OrgScope;
let scopeB: OrgScope;
let clientA: string;

beforeAll(async () => {
  f = await createFixture();
  scopeA = new OrgScope(f.orgA, f.userA);
  scopeB = new OrgScope(f.orgB, f.userB);
  const created = await scopeA.createClient({
    displayName: "Portal Test Client",
    type: "individual",
    preferredChannel: "sms",
    phone: "+14165550142",
    assignedAccountantId: f.userA,
    createdBy: f.userA,
  });
  clientA = created.id;
});

afterAll(async () => {
  await destroyFixture(f);
  await pool.end();
});

afterEach(() => {
  vi.useRealTimers();
  resetRateLimits();
});

async function mint(overrides: Partial<Parameters<typeof mintPortalLink>[1]> = {}) {
  return mintPortalLink(scopeA, {
    clientId: clientA,
    recipientName: "Portal Test Client",
    recipientPhone: "+14165550142",
    createdBy: f.userA,
    ...overrides,
  });
}

/** The last texted 6-digit code for a token, read from the outbox like a client would. */
async function lastOtpCode(tokenId: string): Promise<string> {
  const outbox = await scopeA.listOutbox(20);
  const sms = outbox.find(
    (m) =>
      m.channel === "sms" &&
      (m.meta as { kind?: string; portalTokenId?: string } | null)?.kind === "portal_otp" &&
      (m.meta as { portalTokenId?: string } | null)?.portalTokenId === tokenId
  );
  const code = sms?.body.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error("No OTP SMS found in outbox");
  return code;
}

describe("mint + validate", () => {
  it("mints a link whose raw token is only ever stored as a sha256 hash", async () => {
    const { url, token } = await mint();
    const raw = url.split("/portal/")[1];
    expect(raw).toBeTruthy();
    expect(token.tokenHash).toBe(hashPortalToken(raw));
    expect(token.tokenHash).not.toContain(raw.slice(0, 24));
    expect(url).toContain("/portal/");

    const validated = await validatePortalLink(raw);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.value.token.id).toBe(token.id);
      expect(validated.value.token.clientId).toBe(clientA);
      expect(validated.value.scope.orgId).toBe(f.orgA);
    }
  });

  it("rejects garbage, tampered, and unknown tokens as 'invalid'", async () => {
    expect(await validatePortalLink("not-a-jwt")).toMatchObject({ ok: false, problem: "invalid" });

    const { url } = await mint();
    const raw = url.split("/portal/")[1];
    const tampered = raw.slice(0, -4) + "AAAA";
    expect(await validatePortalLink(tampered)).toMatchObject({ ok: false, problem: "invalid" });
  });

  it("honours revocation", async () => {
    const { url, token } = await mint();
    await scopeA.updatePortalToken(token.id, { revokedAt: new Date() });
    expect(await validatePortalLink(url.split("/portal/")[1])).toMatchObject({
      ok: false,
      problem: "revoked",
    });
  });

  it("expires 7-day-old unopened links and 15-minute-old opened links", async () => {
    const { url, token } = await mint();
    const raw = url.split("/portal/")[1];

    // Simulate first-open 20 minutes ago — opened window passed.
    await scopeA.updatePortalToken(token.id, {
      openedAt: new Date(Date.now() - PORTAL_LINK_OPENED_TTL_MS - 5 * 60 * 1000),
    });
    expect(await validatePortalLink(raw)).toMatchObject({ ok: false, problem: "expired" });

    // Hard 7-day expiry (row side; the JWT exp matches it for unopened
    // links). Backdated via the ADMIN connection — RLS (correctly) blocks
    // the app role from touching rows without an org context.
    const { url: url2, token: token2 } = await mint();
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    try {
      await admin.query(
        `update portal_token set expires_at = now() - interval '1 hour' where id = $1`,
        [token2.id]
      );
    } finally {
      await admin.end();
    }
    expect(await validatePortalLink(url2.split("/portal/")[1])).toMatchObject({
      ok: false,
      problem: "expired",
    });
  });
});

describe("SMS OTP challenge", () => {
  it("open → code texted to the recipient → correct code verifies", async () => {
    const { url, token } = await mint();
    const raw = url.split("/portal/")[1];

    const opened = await markOpenedAndSendOtp(scopeA, token);
    expect(opened.openedAt).toBeTruthy();
    expect(opened.otpHash).toBeTruthy();
    // Raw code never lands in the row — only its hash.
    const code = await lastOtpCode(token.id);
    expect(opened.otpHash).not.toContain(code);

    const result = await verifyOtp(scopeA, opened, code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token.verifiedAt).toBeTruthy();

    // Link stays valid inside the opened window after verification.
    expect((await validatePortalLink(raw)).ok).toBe(true);
  });

  it("re-opening inside the window reuses the outstanding code", async () => {
    const { token } = await mint();
    const opened = await markOpenedAndSendOtp(scopeA, token);
    const again = await markOpenedAndSendOtp(scopeA, opened);
    expect(again.otpHash).toBe(opened.otpHash);
    expect(again.openedAt?.getTime()).toBe(opened.openedAt?.getTime());
  });

  it("5 wrong codes lock the token durably — even a later correct code fails", async () => {
    const { token } = await mint();
    const opened = await markOpenedAndSendOtp(scopeA, token);
    const code = await lastOtpCode(token.id);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 1; i <= PORTAL_OTP_MAX_ATTEMPTS; i++) {
      const res = await verifyOtp(scopeA, (await scopeA.getPortalToken(token.id))!, wrong);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.problem).toBe(i < PORTAL_OTP_MAX_ATTEMPTS ? "wrong_code" : "locked");
    }

    const after = (await scopeA.getPortalToken(token.id))!;
    expect(after.otpAttempts).toBe(PORTAL_OTP_MAX_ATTEMPTS);
    expect(portalTokenProblem(after)).toBe("locked");
    const finalTry = await verifyOtp(scopeA, after, code);
    expect(finalTry).toMatchObject({ ok: false, problem: "locked" });
  });

  it("expired codes are refused but a fresh code still works", async () => {
    const { token } = await mint();
    const opened = await markOpenedAndSendOtp(scopeA, token);
    await scopeA.updatePortalToken(token.id, {
      otpExpiresAt: new Date(Date.now() - 1000),
    });
    const stale = await verifyOtp(scopeA, (await scopeA.getPortalToken(token.id))!, "123456");
    expect(stale).toMatchObject({ ok: false, problem: "expired_code" });

    const reissued = await issueOtp(scopeA, opened);
    const code = await lastOtpCode(token.id);
    const res = await verifyOtp(scopeA, reissued, code);
    expect(res.ok).toBe(true);
  });
});

describe("tenancy isolation", () => {
  it("org B cannot see or update org A's portal tokens", async () => {
    const { url, token } = await mint();
    const raw = url.split("/portal/")[1];

    expect(await scopeB.getPortalToken(token.id)).toBeNull();
    expect(await scopeB.getPortalTokenByHash(hashPortalToken(raw))).toBeNull();
    expect(await scopeB.updatePortalToken(token.id, { revokedAt: new Date() })).toBeNull();
    // ...and the token still validates fine for org A.
    expect((await validatePortalLink(raw)).ok).toBe(true);
  });

  it("cross-org portal.manage_links references throw (tenancy violation)", () => {
    const actor: Actor = { userId: f.userA, orgId: f.orgA, role: "owner" };
    expect(() =>
      can(actor, "portal.manage_links", { orgId: f.orgB, type: "client", id: clientA })
    ).toThrow();
  });
});

describe("permission matrix for portal.manage_links", () => {
  const resource = (assignedTo: string | null) => ({
    orgId: f.orgA,
    type: "client",
    id: "some-client",
    assignedTo,
  });

  it("clerk may issue links (front-desk workflow); accountant only for assigned clients", () => {
    const clerk: Actor = { userId: "u-clerk", orgId: f.orgA, role: "clerk" };
    expect(can(clerk, "portal.manage_links", resource(null))).toBe(true);

    const accountant: Actor = { userId: "u-acc", orgId: f.orgA, role: "accountant" };
    expect(can(accountant, "portal.manage_links", resource("u-acc"))).toBe(true);
    expect(can(accountant, "portal.manage_links", resource("someone-else"))).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows max hits per window, then blocks, then resets", () => {
    vi.useFakeTimers();
    expect(rateLimit("k", 3, 1000)).toBe(true);
    expect(rateLimit("k", 3, 1000)).toBe(true);
    expect(rateLimit("k", 3, 1000)).toBe(true);
    expect(rateLimit("k", 3, 1000)).toBe(false);
    // Independent keys don't interfere.
    expect(rateLimit("other", 3, 1000)).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(rateLimit("k", 3, 1000)).toBe(true);
  });
});
