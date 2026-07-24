/**
 * Workload-aware client distribution (post-M10, ADR-0040) — the pure planning
 * core behind the clients-list "distribute" bulk action. No DB: it takes a
 * snapshot and returns a plan the OrgScope layer commits.
 *
 * Goal: hand a selected set of clients to a chosen set of accountants so the
 * resulting per-accountant book sizes are as even as possible, WHILE keeping
 * every client that shares a household on the same accountant (a family / set
 * of related entities should not be split across preparers).
 *
 * Method: collapse the selection into indivisible "units" (one per household,
 * one per household-less client), then place the largest unit first onto the
 * accountant with the smallest projected total — Longest-Processing-Time
 * greedy scheduling, the standard makespan-minimising heuristic. "Projected"
 * starts from each accountant's EXISTING load (passed in), so the split levels
 * whole books, not just this batch. Fully deterministic: unit and accountant
 * ties break by id, so identical input always yields an identical plan (keeps
 * the preview honest and the unit tests stable).
 */

export type DistributableClient = { id: string; householdId: string | null };
export type AccountantLoad = {
  id: string;
  /** Clients this accountant already holds, EXCLUDING the ones being redistributed. */
  currentLoad: number;
};

export type DistributionPlan = {
  assignments: { clientId: string; accountantId: string }[];
  /** Newly assigned count per accountant id (this run only). */
  added: Record<string, number>;
  /** Final projected book size per accountant id (currentLoad + added). */
  totals: Record<string, number>;
};

export function planDistribution(
  clients: DistributableClient[],
  accountants: AccountantLoad[]
): DistributionPlan {
  const added: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const a of accountants) {
    added[a.id] = 0;
    totals[a.id] = a.currentLoad;
  }
  if (accountants.length === 0) return { assignments: [], added, totals };

  // 1. Collapse into indivisible units. Household members travel together;
  //    every household-less client is a unit of one.
  const households = new Map<string, string[]>();
  const units: { key: string; clientIds: string[] }[] = [];
  for (const c of clients) {
    if (c.householdId) {
      const arr = households.get(c.householdId);
      if (arr) arr.push(c.id);
      else households.set(c.householdId, [c.id]);
    } else {
      units.push({ key: `c:${c.id}`, clientIds: [c.id] });
    }
  }
  for (const [hid, ids] of households) units.push({ key: `h:${hid}`, clientIds: ids });

  // 2. Largest units first; stable tie-break by key for reproducibility.
  units.sort((a, b) => b.clientIds.length - a.clientIds.length || (a.key < b.key ? -1 : 1));

  // 3. Greedy placement onto the least-loaded accountant (id tie-break).
  const order = [...accountants].sort((a, b) => (a.id < b.id ? -1 : 1));
  const assignments: { clientId: string; accountantId: string }[] = [];
  for (const unit of units) {
    let best = order[0];
    for (const a of order) if (totals[a.id] < totals[best.id]) best = a;
    for (const clientId of unit.clientIds) assignments.push({ clientId, accountantId: best.id });
    totals[best.id] += unit.clientIds.length;
    added[best.id] += unit.clientIds.length;
  }

  return { assignments, added, totals };
}
