import { describe, expect, it } from "vitest";
import { planDistribution, type DistributableClient } from "@/lib/distribution";

/**
 * Pure planner for the clients-list "distribute" bulk action (ADR-0040):
 * workload-aware, household-preserving, deterministic. No DB.
 */

const clients = (n: number, household?: string): DistributableClient[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, householdId: household ?? null }));

const totalsAssigned = (plan: ReturnType<typeof planDistribution>) =>
  Object.values(plan.added).reduce((a, b) => a + b, 0);

describe("planDistribution", () => {
  it("splits evenly when everyone starts empty", () => {
    const plan = planDistribution(clients(9), [
      { id: "a", currentLoad: 0 },
      { id: "b", currentLoad: 0 },
      { id: "c", currentLoad: 0 },
    ]);
    expect(plan.added).toEqual({ a: 3, b: 3, c: 3 });
    expect(totalsAssigned(plan)).toBe(9);
  });

  it("spreads the remainder so counts differ by at most one", () => {
    const plan = planDistribution(clients(10), [
      { id: "a", currentLoad: 0 },
      { id: "b", currentLoad: 0 },
      { id: "c", currentLoad: 0 },
    ]);
    const counts = Object.values(plan.added).sort();
    expect(counts).toEqual([3, 3, 4]);
  });

  it("is workload-aware — levels existing books, not just the batch", () => {
    // b already holds 5; give 5 new clients → all should go to a to level at 5/5.
    const plan = planDistribution(clients(5), [
      { id: "a", currentLoad: 0 },
      { id: "b", currentLoad: 5 },
    ]);
    expect(plan.added.a).toBe(5);
    expect(plan.added.b).toBe(0);
    expect(plan.totals).toEqual({ a: 5, b: 5 });
  });

  it("keeps a household together on one accountant", () => {
    // 3 household members + 3 singles across 3 accountants: the household is one
    // unit, so its 3 members share an accountant rather than being split.
    const household = clients(3, "h1");
    const singles: DistributableClient[] = [
      { id: "s1", householdId: null },
      { id: "s2", householdId: null },
      { id: "s3", householdId: null },
    ];
    const plan = planDistribution([...household, ...singles], [
      { id: "a", currentLoad: 0 },
      { id: "b", currentLoad: 0 },
      { id: "c", currentLoad: 0 },
    ]);
    const owners = new Set(
      household.map((c) => plan.assignments.find((x) => x.clientId === c.id)!.accountantId)
    );
    expect(owners.size).toBe(1);
    expect(totalsAssigned(plan)).toBe(6);
  });

  it("assigns every client exactly once", () => {
    const plan = planDistribution(clients(23), [
      { id: "a", currentLoad: 2 },
      { id: "b", currentLoad: 7 },
      { id: "c", currentLoad: 0 },
      { id: "d", currentLoad: 1 },
    ]);
    const assigned = plan.assignments.map((a) => a.clientId);
    expect(new Set(assigned).size).toBe(23);
    expect(assigned).toHaveLength(23);
  });

  it("is deterministic for identical input", () => {
    const input = clients(17);
    const accts = [
      { id: "a", currentLoad: 1 },
      { id: "b", currentLoad: 0 },
      { id: "c", currentLoad: 3 },
    ];
    expect(planDistribution(input, accts)).toEqual(planDistribution(input, accts));
  });

  it("returns an empty plan when no accountants are chosen", () => {
    const plan = planDistribution(clients(5), []);
    expect(plan.assignments).toEqual([]);
  });
});
