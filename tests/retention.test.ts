import { describe, expect, it } from "vitest";
import {
  RETENTION_YEARS,
  isPastRetention,
  retainedYears,
  retentionHorizon,
} from "@/lib/retention";

/**
 * M9 retention (ADR-0034) — pure horizon math. The review flow is delete-free;
 * these just confirm the 7-year cutoff and "held for N years" reporting.
 */

describe("retention horizon", () => {
  const now = new Date("2026-07-23T00:00:00Z");

  it("is exactly RETENTION_YEARS before now", () => {
    expect(RETENTION_YEARS).toBe(7);
    expect(retentionHorizon(now).getUTCFullYear()).toBe(2019);
  });

  it("flags documents at/older than the horizon, not newer ones", () => {
    expect(isPastRetention(new Date("2019-07-23T00:00:00Z"), now)).toBe(true);
    expect(isPastRetention(new Date("2019-01-01T00:00:00Z"), now)).toBe(true);
    expect(isPastRetention(new Date("2020-01-01T00:00:00Z"), now)).toBe(false);
    expect(isPastRetention(now, now)).toBe(false);
  });

  it("reports whole years retained", () => {
    expect(retainedYears(new Date("2026-01-01T00:00:00Z"), now)).toBe(0);
    expect(retainedYears(new Date("2019-01-01T00:00:00Z"), now)).toBe(7);
    expect(retainedYears(new Date("2010-01-01T00:00:00Z"), now)).toBe(16);
  });
});
