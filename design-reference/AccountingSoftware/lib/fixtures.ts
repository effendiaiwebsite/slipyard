export const firm = {
  name: "Lakeside CPA",
  user: { name: "Sarah Kovac", role: "Senior Accountant" },
};

export type EntityType = "T1" | "T2" | "T3";
export type Stage = "Received" | "In Prep" | "Manager Review" | "Partner Review" | "Client Approval" | "Filed";

export const clients = [
  // T1 personal
  { id: "c1", name: "Margaret Chen", type: "T1" as EntityType, ye: "2025-12-31", stage: "Manager Review" as Stage, owner: "Sarah K", lastContact: "2 days ago", wip: 320, aiFlags: 4, risk: 12 },
  { id: "c5", name: "David Thompson", type: "T1" as EntityType, ye: "2025-12-31", stage: "Client Approval" as Stage, owner: "Sarah K", lastContact: "today", wip: 240, aiFlags: 1, risk: 8 },
  { id: "c7", name: "Sarah Williams", type: "T1" as EntityType, ye: "2025-12-31", stage: "In Prep" as Stage, owner: "Sarah K", lastContact: "today", wip: 410, aiFlags: 2, risk: 21 },
  { id: "c9", name: "Liu Xiaoling", type: "T1" as EntityType, ye: "2025-12-31", stage: "In Prep" as Stage, owner: "Sarah K", lastContact: "today", wip: 380, aiFlags: 3, risk: 18 },
  { id: "c10", name: "Robert Tremblay", type: "T1" as EntityType, ye: "2025-12-31", stage: "Filed" as Stage, owner: "Sarah K", lastContact: "1 week ago", wip: 0, aiFlags: 0, risk: 9 },
  { id: "c11", name: "Emma O'Connor", type: "T1" as EntityType, ye: "2025-12-31", stage: "Client Approval" as Stage, owner: "Mike L", lastContact: "yesterday", wip: 290, aiFlags: 2, risk: 14 },
  { id: "c12", name: "Hassan Al-Rashid", type: "T1" as EntityType, ye: "2025-12-31", stage: "Received" as Stage, owner: "Nina P", lastContact: "4 days ago", wip: 0, aiFlags: 1, risk: 22 },
  { id: "c13", name: "Jennifer Park", type: "T1" as EntityType, ye: "2025-12-31", stage: "Manager Review" as Stage, owner: "Sarah K", lastContact: "2 days ago", wip: 410, aiFlags: 2, risk: 11 },
  { id: "c14", name: "Marcus Johansson", type: "T1" as EntityType, ye: "2025-12-31", stage: "Manager Review" as Stage, owner: "Mike L", lastContact: "1 week ago", wip: 540, aiFlags: 3, risk: 17 },
  { id: "c15", name: "Olivia Nguyen", type: "T1" as EntityType, ye: "2025-12-31", stage: "In Prep" as Stage, owner: "Jordan T", lastContact: "today", wip: 720, aiFlags: 4, risk: 38 },
  { id: "c25", name: "Paulo Costa", type: "T1" as EntityType, ye: "2025-12-31", stage: "Received" as Stage, owner: "Nina P", lastContact: "yesterday", wip: 0, aiFlags: 0, risk: 7 },
  { id: "c26", name: "Yuki Tanaka", type: "T1" as EntityType, ye: "2025-12-31", stage: "Filed" as Stage, owner: "Mike L", lastContact: "2 weeks ago", wip: 0, aiFlags: 0, risk: 6 },
  { id: "c27", name: "Devon Brown", type: "T1" as EntityType, ye: "2025-12-31", stage: "Filed" as Stage, owner: "Sarah K", lastContact: "10 days ago", wip: 0, aiFlags: 0, risk: 11 },

  // T2 corporate
  { id: "c2", name: "Acme Holdings Ltd.", type: "T2" as EntityType, ye: "2025-12-31", stage: "In Prep" as Stage, owner: "Mike L", lastContact: "1 week ago", wip: 1820, aiFlags: 2, risk: 34 },
  { id: "c4", name: "Riverside Plumbing Inc.", type: "T2" as EntityType, ye: "2025-09-30", stage: "Partner Review" as Stage, owner: "Anita R", lastContact: "yesterday", wip: 4120, aiFlags: 3, risk: 47 },
  { id: "c6", name: "Lakeshore Cafe Ltd.", type: "T2" as EntityType, ye: "2025-12-31", stage: "In Prep" as Stage, owner: "Mike L", lastContact: "5 days ago", wip: 980, aiFlags: 5, risk: 62 },
  { id: "c8", name: "Boreal Tech Inc.", type: "T2" as EntityType, ye: "2025-12-31", stage: "Received" as Stage, owner: "Anita R", lastContact: "4 days ago", wip: 0, aiFlags: 6, risk: 71 },
  { id: "c16", name: "Northstar Logistics Ltd.", type: "T2" as EntityType, ye: "2025-06-30", stage: "Filed" as Stage, owner: "Anita R", lastContact: "2 weeks ago", wip: 0, aiFlags: 0, risk: 31 },
  { id: "c17", name: "Maple Ridge Dental Corp.", type: "T2" as EntityType, ye: "2025-12-31", stage: "Client Approval" as Stage, owner: "Anita R", lastContact: "yesterday", wip: 1240, aiFlags: 2, risk: 26 },
  { id: "c18", name: "Bytewise Software Inc.", type: "T2" as EntityType, ye: "2025-12-31", stage: "Manager Review" as Stage, owner: "Anita R", lastContact: "3 days ago", wip: 2100, aiFlags: 4, risk: 52 },
  { id: "c19", name: "Beaver Creek Holdings Ltd.", type: "T2" as EntityType, ye: "2025-12-31", stage: "In Prep" as Stage, owner: "Mike L", lastContact: "5 days ago", wip: 1480, aiFlags: 3, risk: 41 },
  { id: "c20", name: "Aurora Construction Ltd.", type: "T2" as EntityType, ye: "2025-12-31", stage: "Partner Review" as Stage, owner: "Anita R", lastContact: "today", wip: 3200, aiFlags: 2, risk: 44 },
  { id: "c21", name: "Coastal Marine Services Ltd.", type: "T2" as EntityType, ye: "2025-09-30", stage: "Received" as Stage, owner: "Mike L", lastContact: "yesterday", wip: 0, aiFlags: 1, risk: 36 },
  { id: "c22", name: "The Iron Skillet Restaurants Ltd.", type: "T2" as EntityType, ye: "2025-12-31", stage: "Partner Review" as Stage, owner: "Anita R", lastContact: "today", wip: 2840, aiFlags: 5, risk: 58 },

  // T3 trust
  { id: "c3", name: "Patel Family Trust", type: "T3" as EntityType, ye: "2025-12-31", stage: "Received" as Stage, owner: "Sarah K", lastContact: "3 weeks ago", wip: 0, aiFlags: 1, risk: 28 },
  { id: "c23", name: "Macdonald Family Trust", type: "T3" as EntityType, ye: "2025-12-31", stage: "In Prep" as Stage, owner: "Jordan T", lastContact: "1 week ago", wip: 680, aiFlags: 2, risk: 24 },
  { id: "c24", name: "Singh Estate", type: "T3" as EntityType, ye: "2025-12-31", stage: "Filed" as Stage, owner: "Sarah K", lastContact: "3 weeks ago", wip: 0, aiFlags: 0, risk: 15 },
  { id: "c28", name: "O'Brien Testamentary Trust", type: "T3" as EntityType, ye: "2025-12-31", stage: "Manager Review" as Stage, owner: "Jordan T", lastContact: "5 days ago", wip: 920, aiFlags: 1, risk: 32 },
];

export const kpis = [
  { label: "Active engagements", value: "47", delta: "+3 this week", tone: "neutral" as const },
  { label: "Returns due this week", value: "12", delta: "4 unassigned", tone: "warn" as const },
  { label: "Billable hours (WTD)", value: "124.5", delta: "82% utilization", tone: "success" as const },
  { label: "AI suggestions pending", value: "12", delta: "5 high-impact", tone: "ai" as const },
];

export const deadlines = [
  { client: "Margaret Chen", form: "T1", due: "2026-05-01", stage: "Manager Review", owner: "Sarah K", urgency: "today" },
  { client: "David Thompson", form: "T1", due: "2026-05-01", stage: "Client Approval", owner: "Sarah K", urgency: "today" },
  { client: "Emma O'Connor", form: "T1", due: "2026-05-01", stage: "Client Approval", owner: "Mike L", urgency: "today" },
  { client: "Sarah Williams", form: "T1 (rental)", due: "2026-06-15", stage: "In Prep", owner: "Sarah K", urgency: "soon" },
  { client: "Lakeshore Cafe Ltd.", form: "GST/HST Q1", due: "2026-05-07", stage: "Awaiting docs", owner: "Mike L", urgency: "soon" },
  { client: "Riverside Plumbing Inc.", form: "T2", due: "2026-03-31", stage: "Partner Review", owner: "Anita R", urgency: "overdue" },
  { client: "Bytewise Software Inc.", form: "T2", due: "2026-06-30", stage: "Manager Review", owner: "Anita R", urgency: "later" },
  { client: "Boreal Tech Inc.", form: "T2", due: "2026-06-30", stage: "Received", owner: "Anita R", urgency: "later" },
  { client: "Patel Family Trust", form: "T3", due: "2026-03-31", stage: "Received", owner: "Sarah K", urgency: "overdue" },
  { client: "Acme Holdings Ltd.", form: "T2", due: "2026-06-30", stage: "In Prep", owner: "Mike L", urgency: "later" },
  { client: "The Iron Skillet Restaurants Ltd.", form: "T2", due: "2026-06-30", stage: "Partner Review", owner: "Anita R", urgency: "later" },
  { client: "Aurora Construction Ltd.", form: "T2", due: "2026-06-30", stage: "Partner Review", owner: "Anita R", urgency: "later" },
];

export const aiInsights = [
  { id: "i1", severity: "high" as const, client: "Boreal Tech Inc.", title: "Unused SR&ED credits expiring", body: "$24,500 in unused SR&ED ITCs from 2017 will expire after the 2027 T2. Consider claiming on current return.", impact: 24500 },
  { id: "i2", severity: "high" as const, client: "Margaret Chen", title: "RRSP room of $9,700 unused", body: "Top-up before NOA assessment unlocks an estimated $2,910 in additional refund (43.4% marginal).", impact: 2910 },
  { id: "i6", severity: "high" as const, client: "Bytewise Software Inc.", title: "SR&ED enhanced credit eligible", body: "FY25 expenditures of $845k qualify for 35% refundable ITC under CCPC rules. Estimated refund $295,750.", impact: 295750 },
  { id: "i3", severity: "med" as const, client: "David Thompson", title: "AFR slip mismatch", body: "Tangerine T5 ($340) appears on CRA AFR but is missing from client-uploaded documents.", impact: 0 },
  { id: "i4", severity: "med" as const, client: "Lakeshore Cafe Ltd.", title: "GST filing in 6 days, no March transactions", body: "32 March bank transactions remain uncategorized. Recommend running auto-categorizer.", impact: 0 },
  { id: "i7", severity: "med" as const, client: "Aurora Construction Ltd.", title: "Vehicle business-use unusual", body: "Three of five vehicles claim 100% business — outside CRA expected range for general contractors. Review logbooks.", impact: 0 },
  { id: "i8", severity: "med" as const, client: "Marcus Johansson", title: "Pension splitting opportunity", body: "Retired client with $42,600 OMERS pension and lower-income spouse. Splitting saves est. $1,840.", impact: 1840 },
  { id: "i5", severity: "low" as const, client: "Sarah Williams", title: "Rental — depreciation election", body: "First-year rental conversion — flag CCA election decision before filing (T776 line 9936).", impact: 0 },
];

export const workloadByStage: { stage: Stage; count: number }[] = [
  { stage: "Received", count: 8 },
  { stage: "In Prep", count: 14 },
  { stage: "Manager Review", count: 9 },
  { stage: "Partner Review", count: 5 },
  { stage: "Client Approval", count: 4 },
  { stage: "Filed", count: 7 },
];

// --- T1 workspace (Margaret Chen) ---
export const t1Client = { name: "Margaret Chen", sin: "•••-•••-487", taxYear: 2025, province: "ON", spouse: "Daniel Chen", status: "Manager Review", preparer: "Sarah Kovac" };
export const t1Income = [
  { line: "10100", label: "Employment income (T4 — RBC)", amount: 87400 },
  { line: "12000", label: "Eligible dividends (T3 — Manulife)", amount: 2890 },
  { line: "12100", label: "Interest & investment income (T5 — RBC)", amount: 1250 },
  { line: "13000", label: "Other income — bonus arrears", amount: 1800 },
];
export const t1Deductions = [
  { line: "20800", label: "RRSP contributions", amount: 8500 },
  { line: "21200", label: "Union dues", amount: 890 },
  { line: "21400", label: "Child care expenses", amount: 4200 },
  { line: "22900", label: "Other employment expenses (T2200)", amount: 1340 },
];
export const t1Credits = [
  { line: "34900", label: "Charitable donations", amount: 1500 },
  { line: "33099", label: "Medical expenses", amount: 890 },
  { line: "32300", label: "Tuition (T2202)", amount: 0 },
];
export const t1Slips = [
  { name: "T4 — Royal Bank of Canada", status: "matched" as const, ocrConf: 0.99 },
  { name: "T5 — Royal Bank of Canada", status: "matched" as const, ocrConf: 0.97 },
  { name: "T3 — Manulife", status: "matched" as const, ocrConf: 0.96 },
  { name: "RRSP receipt — Sun Life", status: "matched" as const, ocrConf: 0.94 },
  { name: "Donation receipt — UNICEF", status: "matched" as const, ocrConf: 0.91 },
  { name: "T5 — Tangerine", status: "afr-only" as const, ocrConf: 0 },
];
export const t1Optimizations = [
  { id: "o1", title: "Top up RRSP — $9,700 remaining room", detail: "Marginal rate 43.4% (ON). Contributing $9,700 by Mar 1, 2026 reduces 2025 tax by ~$4,210.", saving: 4210, confidence: 0.92, source: "CRA RRSP deduction limit statement, 2024 NOA" },
  { id: "o2", title: "Pension income splitting with Daniel", detail: "Shift $4,200 of eligible pension to spouse (lower bracket). Estimated joint saving $620.", saving: 620, confidence: 0.88, source: "S1, line 21000 — joint election" },
  { id: "o3", title: "Transfer medical to spouse", detail: "Daniel's net income is lower — claiming the $890 medical pool there saves the 3% threshold haircut.", saving: 134, confidence: 0.95, source: "ITA s.118.2(2)" },
  { id: "o4", title: "FHSA contribution ($8,000 annual room)", detail: "First-time buyer status confirmed in intake. Contributing $8,000 saves $3,470 immediately and grows tax-free.", saving: 3470, confidence: 0.79, source: "Intake Q14 — first home plans within 5y" },
];
export const t1AfrMismatches = [
  { slip: "T5 — Tangerine", line: "12100", amount: 340, status: "Missing in client docs" },
  { slip: "T4A — University of Toronto", line: "13000", amount: 0, status: "Cleared (zero amount)" },
];
export const t1AuditRisk = {
  score: 12, band: "Low",
  drivers: [
    { label: "Home office (T777)", weight: 0.04, note: "Claim under typical range for ON" },
    { label: "Vehicle business %", weight: 0.03, note: "Logbook attached, 28% — within norm" },
    { label: "Donations / income ratio", weight: 0.02, note: "1.7% — unremarkable" },
    { label: "T1135 foreign property", weight: 0, note: "Not applicable" },
  ],
};

// --- Bank feed (Riverside Plumbing) ---
export const bookClient = { name: "Riverside Plumbing Inc.", account: "RBC Business Chequing — •••4827", balance: 47820.16, lastSync: "2 min ago" };
export const bookKpis = [
  { label: "Auto-categorized", value: "184", sub: "this month", tone: "success" as const },
  { label: "Needs review", value: "9", sub: "low confidence", tone: "warn" as const },
  { label: "Income (MTD)", value: "$58,420", sub: "+12% vs LM", tone: "neutral" as const },
  { label: "Expenses (MTD)", value: "$31,914", sub: "-4% vs LM", tone: "neutral" as const },
];
export const bookTxns = [
  { date: "2026-04-28", desc: "HOMEDEPOT #7041 ETOBICOKE", amount: -842.18, cat: "COGS — Materials", conf: 0.98, gst: "Full ITC", status: "auto" },
  { date: "2026-04-28", desc: "DEPOSIT — INV 1042 SARAH B.", amount: 3200.00, cat: "Sales — Plumbing services", conf: 0.99, gst: "GST collected 13%", status: "auto" },
  { date: "2026-04-27", desc: "PETRO-CANADA 18722", amount: -94.40, cat: "Vehicle — Fuel", conf: 0.99, gst: "Full ITC", status: "auto" },
  { date: "2026-04-27", desc: "STAPLES BUSINESS 0089", amount: -167.21, cat: "Office supplies", conf: 0.96, gst: "Full ITC", status: "auto" },
  { date: "2026-04-26", desc: "E-TRANSFER — J. MACDONALD", amount: -1500.00, cat: "Owner draw", conf: 0.71, gst: "N/A", status: "review" },
  { date: "2026-04-26", desc: "ROGERS BUSINESS *MOBILE", amount: -118.65, cat: "Telecom", conf: 0.99, gst: "Full ITC", status: "auto" },
  { date: "2026-04-25", desc: "DEPOSIT — INV 1041 LAKEVIEW APTS", amount: 8400.00, cat: "Sales — Commercial", conf: 0.99, gst: "GST collected 13%", status: "auto" },
  { date: "2026-04-25", desc: "AMZN MKTP CA *RT4892", amount: -612.45, cat: "COGS — Materials", conf: 0.62, gst: "Full ITC", status: "review" },
  { date: "2026-04-24", desc: "TIM HORTONS #4892", amount: -42.18, cat: "Meals & entertainment (50%)", conf: 0.88, gst: "50% ITC", status: "auto" },
  { date: "2026-04-24", desc: "WSIB ONTARIO PMT", amount: -612.00, cat: "Payroll — WSIB premium", conf: 0.99, gst: "N/A", status: "auto" },
  { date: "2026-04-23", desc: "INTERAC E-TRANSFER FROM CASH", amount: 600.00, cat: "Owner contribution", conf: 0.55, gst: "N/A", status: "review" },
  { date: "2026-04-23", desc: "BELL CANADA *INTERNET", amount: -89.99, cat: "Utilities — Internet", conf: 0.97, gst: "Full ITC", status: "auto" },
];
export const bookAiTips = [
  { title: "Recurring vendor not yet ruled", body: "AMZN MKTP CA appears 8x at varied amounts — categorize once and we'll auto-rule." },
  { title: "Possible personal expense", body: "TIM HORTONS at 6:42am on a Sunday — confirm with client before claiming as M&E." },
  { title: "GST collected drift", body: "Q1 GST collected ($14,200) implies sales of $109,231; bookings show $104,890. ~$4,341 gap." },
];

// --- Time & billing ---
export const billingKpis = [
  { label: "WIP balance", value: "$48,210", sub: "$8,200 over 60d", tone: "warn" as const },
  { label: "Billed (MTD)", value: "$72,940", sub: "+18% vs LM", tone: "success" as const },
  { label: "Realization", value: "87%", sub: "firm target 85%", tone: "success" as const },
  { label: "Utilization", value: "82%", sub: "WTD avg", tone: "neutral" as const },
];
export const timeToday = [
  { time: "08:30 - 09:15", client: "Margaret Chen", task: "T1 review", hours: 0.75, billable: true },
  { time: "09:30 - 11:00", client: "Acme Holdings Ltd.", task: "T2 prep — schedule 1", hours: 1.5, billable: true },
  { time: "11:00 - 11:20", client: "Internal", task: "Team standup", hours: 0.33, billable: false },
  { time: "13:00 - 15:30", client: "Riverside Plumbing", task: "Audit defense file", hours: 2.5, billable: true },
  { time: "15:45 - 16:30", client: "Patel Family Trust", task: "T3 intake call", hours: 0.75, billable: true },
];
export const wipAging = [
  { client: "Old client (write-off)", current: 0, d30: 0, d60: 0, d90: 8200, total: 8200 },
  { client: "Riverside Plumbing Inc.", current: 1200, d30: 1620, d60: 1300, d90: 0, total: 4120 },
  { client: "Aurora Construction Ltd.", current: 1200, d30: 1620, d60: 380, d90: 0, total: 3200 },
  { client: "The Iron Skillet Restaurants Ltd.", current: 0, d30: 1820, d60: 1020, d90: 0, total: 2840 },
  { client: "Bytewise Software Inc.", current: 2100, d30: 0, d60: 0, d90: 0, total: 2100 },
  { client: "Acme Holdings Ltd.", current: 1820, d30: 0, d60: 0, d90: 0, total: 1820 },
  { client: "Beaver Creek Holdings Ltd.", current: 1480, d30: 0, d60: 0, d90: 0, total: 1480 },
  { client: "Maple Ridge Dental Corp.", current: 1240, d30: 0, d60: 0, d90: 0, total: 1240 },
  { client: "Lakeshore Cafe Ltd.", current: 480, d30: 500, d60: 0, d90: 0, total: 980 },
  { client: "O'Brien Testamentary Trust", current: 920, d30: 0, d60: 0, d90: 0, total: 920 },
  { client: "Olivia Nguyen", current: 720, d30: 0, d60: 0, d90: 0, total: 720 },
  { client: "Macdonald Family Trust", current: 680, d30: 0, d60: 0, d90: 0, total: 680 },
];

// --- Document intake ---
type Slip = { type: string; issuer: string; amounts: [string, number][]; conf: number; note?: string };
type Upload = {
  id: string; client: string; file: string; size: string; pages: number;
  uploaded: string; uploadedAt: string; via: string;
  status: "ready" | "review" | "processing"; classified: number; lowConf: number; avgConf: number;
  slips: Slip[];
};

export const intakeUploads: Upload[] = [
  {
    id: "u1", client: "Margaret Chen", file: "tax-docs-2025.pdf", size: "4.2 MB", pages: 14,
    uploaded: "12 min ago", uploadedAt: "2026-04-30 10:42", via: "Client portal",
    status: "ready", classified: 14, lowConf: 0, avgConf: 0.95,
    slips: [
      { type: "T4", issuer: "Royal Bank of Canada", amounts: [["Box 14 — Employment income", 87400], ["Box 16 — CPP contributions", 4055], ["Box 18 — EI premiums", 1077], ["Box 22 — Income tax deducted", 14180]], conf: 0.99 },
      { type: "T5", issuer: "Royal Bank of Canada", amounts: [["Box 13 — Interest from Canadian sources", 1250]], conf: 0.97 },
      { type: "T3", issuer: "Manulife", amounts: [["Box 49 — Eligible dividends", 2890], ["Box 50 — Taxable amount of eligible dividends", 3987]], conf: 0.96 },
      { type: "RRSP receipt", issuer: "Sun Life Financial", amounts: [["Contribution (Mar–Dec 2025)", 8500]], conf: 0.94 },
      { type: "Donation receipt", issuer: "UNICEF Canada", amounts: [["Annual giving 2025", 1500]], conf: 0.91 },
      { type: "Medical receipts (12 items)", issuer: "Various pharmacies", amounts: [["Total prescription receipts", 890]], conf: 0.86 },
    ],
  },
  {
    id: "u2", client: "Sarah Williams", file: "scan_apr_28.pdf", size: "8.7 MB", pages: 22,
    uploaded: "1 hour ago", uploadedAt: "2026-04-30 09:42", via: "Email forward",
    status: "review", classified: 19, lowConf: 3, avgConf: 0.81,
    slips: [
      { type: "T4", issuer: "Hospital for Sick Children", amounts: [["Box 14 — Employment income", 124500], ["Box 16 — CPP", 4055], ["Box 18 — EI", 1077], ["Box 22 — Income tax", 28400]], conf: 0.98 },
      { type: "T776 — Rental statement", issuer: "Self-prepared", amounts: [["Gross rental income", 28800], ["Total expenses claimed", 12420], ["Net rental income", 16380]], conf: 0.74, note: "First-year rental — CCA election needed before filing (T776 line 9936)" },
      { type: "Mortgage interest statement", issuer: "TD Canada Trust", amounts: [["Interest paid 2025", 8920]], conf: 0.93 },
      { type: "Property tax statement", issuer: "City of Toronto", amounts: [["2025 final levy", 4200]], conf: 0.96 },
      { type: "Unclassified", issuer: "?", amounts: [], conf: 0.42, note: "Pages 18–20 could not be confidently classified — appear to be handwritten notes" },
      { type: "Unclassified", issuer: "?", amounts: [], conf: 0.51, note: "Page 21 — partial scan, needs manual review" },
    ],
  },
  {
    id: "u3", client: "David Thompson", file: "rrsp_receipts.zip", size: "1.2 MB", pages: 4,
    uploaded: "3 hours ago", uploadedAt: "2026-04-30 07:42", via: "Mobile upload",
    status: "ready", classified: 4, lowConf: 0, avgConf: 0.96,
    slips: [
      { type: "RRSP receipt", issuer: "Wealthsimple", amounts: [["First-60-days (Jan–Feb 2026)", 2400], ["Remainder of 2025", 5600]], conf: 0.97 },
      { type: "RRSP receipt", issuer: "TD Direct Investing", amounts: [["Contribution 2025", 4000]], conf: 0.98 },
      { type: "FHSA contribution", issuer: "Wealthsimple", amounts: [["2025 contribution", 8000]], conf: 0.95 },
      { type: "Charitable donation", issuer: "Heart & Stroke Foundation", amounts: [["Monthly giving 2025", 250]], conf: 0.94 },
    ],
  },
  {
    id: "u4", client: "Acme Holdings Ltd.", file: "FY25_invoices.pdf", size: "42.1 MB", pages: 87,
    uploaded: "yesterday", uploadedAt: "2026-04-29 16:18", via: "Client portal",
    status: "review", classified: 81, lowConf: 6, avgConf: 0.87,
    slips: [
      { type: "Sales invoices (54 items)", issuer: "Various clients", amounts: [["Total revenue", 2840000], ["GST/HST collected", 369200]], conf: 0.94 },
      { type: "Vendor bills (27 items)", issuer: "Various suppliers", amounts: [["Total expenses", 1620000], ["GST/HST paid", 210600]], conf: 0.91 },
      { type: "Payroll summary", issuer: "Self-prepared", amounts: [["Wages paid", 412000], ["Employer CPP/EI", 28400]], conf: 0.96 },
      { type: "Unclassified", issuer: "?", amounts: [], conf: 0.34, note: "Pages 41–46 appear to be handwritten meeting notes, not invoices" },
    ],
  },
  {
    id: "u5", client: "Patel Family Trust", file: "trustee_pkg.pdf", size: "3.8 MB", pages: 9,
    uploaded: "2 min ago", uploadedAt: "2026-04-30 10:52", via: "Email forward",
    status: "processing", classified: 0, lowConf: 0, avgConf: 0,
    slips: [],
  },
  {
    id: "u6", client: "Liu Xiaoling", file: "2025-tax-package.pdf", size: "2.1 MB", pages: 8,
    uploaded: "4 hours ago", uploadedAt: "2026-04-30 06:42", via: "Client portal",
    status: "ready", classified: 8, lowConf: 0, avgConf: 0.94,
    slips: [
      { type: "T4", issuer: "University of Toronto", amounts: [["Box 14", 68200], ["Box 16", 3680], ["Box 22", 9420]], conf: 0.99 },
      { type: "T2202 — Tuition", issuer: "University of Toronto (PhD)", amounts: [["Tuition fees paid", 9800]], conf: 0.97 },
      { type: "T4A — Scholarship", issuer: "NSERC", amounts: [["Box 105 — Scholarships", 21000]], conf: 0.96 },
      { type: "Foreign income statement", issuer: "Bank of China", amounts: [["Interest income (CNY converted to CAD)", 1840]], conf: 0.78, note: "Confirm exchange rate basis with client; may trigger T1135 if foreign property > $100k" },
    ],
  },
  {
    id: "u7", client: "Marcus Johansson", file: "pensions_2025.pdf", size: "1.8 MB", pages: 6,
    uploaded: "yesterday", uploadedAt: "2026-04-29 11:20", via: "Mail (scanned by firm)",
    status: "ready", classified: 6, lowConf: 0, avgConf: 0.97,
    slips: [
      { type: "T4A(P) — CPP", issuer: "Service Canada", amounts: [["Box 20 — Total benefits", 14820]], conf: 0.99 },
      { type: "T4A(OAS)", issuer: "Service Canada", amounts: [["Box 18 — OAS", 8480]], conf: 0.99 },
      { type: "T4A — Pension", issuer: "OMERS", amounts: [["Box 16 — Pension", 42600]], conf: 0.98 },
      { type: "T5 — Investment income", issuer: "BMO Nesbitt Burns", amounts: [["Eligible dividends", 4200], ["Interest", 1850]], conf: 0.96 },
    ],
  },
  {
    id: "u8", client: "Bytewise Software Inc.", file: "fy25_full_close.zip", size: "112 MB", pages: 312,
    uploaded: "today 8:14am", uploadedAt: "2026-04-30 08:14", via: "API (QuickBooks export)",
    status: "review", classified: 298, lowConf: 14, avgConf: 0.83,
    slips: [
      { type: "GL trial balance", issuer: "QuickBooks Online", amounts: [["Total debits", 8420000], ["Total credits", 8420000]], conf: 0.99 },
      { type: "Sales invoices (63 customers)", issuer: "QBO export", amounts: [["Total revenue", 4150000]], conf: 0.95 },
      { type: "Vendor bills (187 suppliers)", issuer: "QBO export", amounts: [["Total expenses", 3240000]], conf: 0.88 },
      { type: "SR&ED time sheets", issuer: "Internal HR system", amounts: [["Eligible labour hours", 12480], ["Eligible labour cost", 845000]], conf: 0.71, note: "Time allocation to SR&ED projects needs partner sign-off — large claim" },
      { type: "Stock option grant log", issuer: "Carta", amounts: [["FY25 grants issued (count)", 24]], conf: 0.92 },
    ],
  },
  {
    id: "u9", client: "Aurora Construction Ltd.", file: "vehicle_logbooks.pdf", size: "6.4 MB", pages: 18,
    uploaded: "today 9:02am", uploadedAt: "2026-04-30 09:02", via: "Mobile upload",
    status: "review", classified: 16, lowConf: 2, avgConf: 0.79,
    slips: [
      { type: "Vehicle logbook — Truck #1", issuer: "Internal", amounts: [["Total km", 38400], ["Business km claimed", 36480], ["Business %", 95]], conf: 0.86, note: "95% business use is high — flag for review" },
      { type: "Vehicle logbook — Truck #2", issuer: "Internal", amounts: [["Total km", 32100], ["Business km claimed", 32100], ["Business %", 100]], conf: 0.74, note: "100% business use — CRA rarely accepts without auxiliary vehicle for personal use" },
      { type: "Vehicle logbook — Truck #3", issuer: "Internal", amounts: [["Total km", 41200], ["Business km claimed", 30900], ["Business %", 75]], conf: 0.91 },
      { type: "Fuel receipts (28 items)", issuer: "Petro-Canada / Esso", amounts: [["Total fuel cost", 14820]], conf: 0.93 },
    ],
  },
];

export const ocrCategories = [
  { type: "T4 / T4A", count: 142, conf: 0.98 },
  { type: "T5", count: 89, conf: 0.97 },
  { type: "T3", count: 41, conf: 0.95 },
  { type: "RRSP / FHSA receipts", count: 76, conf: 0.94 },
  { type: "Donation receipts", count: 134, conf: 0.93 },
  { type: "Medical receipts", count: 218, conf: 0.86 },
  { type: "T2202 tuition", count: 23, conf: 0.96 },
  { type: "Invoices / receipts", count: 612, conf: 0.78 },
];
export const missingFromPriorYear = [
  { client: "Sarah Williams", slip: "T4 — Hospital for Sick Children", note: "Filed 2024, not yet received for 2025" },
  { client: "David Thompson", slip: "T5 — Tangerine HISA", note: "On AFR but not uploaded" },
  { client: "Margaret Chen", slip: "T2202 — University of Toronto", note: "Filed 2024 (Daniel), check if 2025" },
];

// --- AFR reconciliation ---
export const afrSummary = [
  { label: "Returns checked", value: "23", sub: "of 31 open T1s", tone: "neutral" as const },
  { label: "Mismatches found", value: "11", sub: "across 7 returns", tone: "warn" as const },
  { label: "Dollar at risk", value: "$8,470", sub: "if filed as-is", tone: "danger" as const },
  { label: "Auto-resolvable", value: "8", sub: "pull from AFR", tone: "ai" as const },
];
export const afrMismatchList = [
  { client: "Margaret Chen", slip: "T5 — Tangerine", line: "12100", amount: 340, status: "Missing in client docs", action: "request" },
  { client: "David Thompson", slip: "T5 — Tangerine HISA", line: "12100", amount: 1247, status: "Missing in client docs", action: "request" },
  { client: "Sarah Williams", slip: "T4A — Service Canada CRB", line: "13000", amount: 2400, status: "Client unaware of slip", action: "request" },
  { client: "Liu Xiaoling", slip: "T4A — NSERC scholarship", line: "13010", amount: 21000, status: "On client docs but not yet on AFR", action: "wait" },
  { client: "Marcus Johansson", slip: "T4A(P) — CPP", line: "11400", amount: 14820, status: "AFR matches client docs", action: "resolved" },
  { client: "David Thompson", slip: "T2202 — UofT", line: "32300", amount: 8400, status: "Client docs only — not yet on AFR", action: "wait" },
  { client: "Margaret Chen", slip: "T4A — Bonus arrears", line: "13000", amount: 1800, status: "AFR matches client docs", action: "resolved" },
  { client: "Sarah Williams", slip: "T3 — TD ePremier", line: "12100", amount: 92, status: "Below de minimis — auto-include", action: "auto" },
  { client: "Emma O'Connor", slip: "T5008 — Brokerage trades", line: "12700", amount: 4280, status: "Multi-page slip, partial AFR", action: "request" },
];

// --- Firm-wide optimization advisor ---
export const optKpis = [
  { label: "Opportunities found", value: "47", sub: "across 24 clients", tone: "ai" as const },
  { label: "Total potential savings", value: "$364k", sub: "client benefit", tone: "success" as const },
  { label: "Accepted by preparer", value: "18", sub: "$31,820 locked in", tone: "success" as const },
  { label: "Awaiting review", value: "29", sub: "highest: $295k", tone: "warn" as const },
];
export const firmOptimizations = [
  { client: "Bytewise Software Inc.", category: "SR&ED", title: "Enhanced 35% refundable ITC", impact: 295750, conf: 0.91, status: "review" },
  { client: "Boreal Tech Inc.", category: "SR&ED", title: "Claim expiring SR&ED ITCs", impact: 24500, conf: 0.91, status: "review" },
  { client: "Acme Holdings Ltd.", category: "GRIP / CDA", title: "Capital dividend election", impact: 12200, conf: 0.83, status: "review" },
  { client: "Boreal Tech Inc.", category: "Salary/dividend", title: "Optimal sal/div mix for 2026", impact: 5200, conf: 0.81, status: "review" },
  { client: "Margaret Chen", category: "RRSP", title: "Top up RRSP — $9,700 room", impact: 4210, conf: 0.92, status: "review" },
  { client: "Patel Family Trust", category: "T3 allocation", title: "Allocate income to lower-bracket beneficiary", impact: 4200, conf: 0.89, status: "review" },
  { client: "Margaret Chen", category: "FHSA", title: "FHSA contribution $8,000", impact: 3470, conf: 0.79, status: "review" },
  { client: "Lakeshore Cafe Ltd.", category: "Quick method", title: "Switch to GST/HST quick method", impact: 2100, conf: 0.74, status: "rejected", note: "Client prefers ITC tracking" },
  { client: "Marcus Johansson", category: "Pension split", title: "Pension splitting with spouse", impact: 1840, conf: 0.94, status: "accepted" },
  { client: "David Thompson", category: "Pension split", title: "Pension split with Lisa T.", impact: 1840, conf: 0.94, status: "accepted" },
  { client: "Maple Ridge Dental Corp.", category: "RRSP", title: "Owner RRSP via salary draw optimization", impact: 1620, conf: 0.85, status: "review" },
  { client: "Beaver Creek Holdings Ltd.", category: "Inter-co", title: "Inter-corporate dividend deduction", impact: 1480, conf: 0.92, status: "review" },
  { client: "Olivia Nguyen", category: "Self-employed", title: "Home office reasonableness — 22% claim", impact: 1240, conf: 0.83, status: "review" },
  { client: "Riverside Plumbing", category: "T2200", title: "Home office reasonable apportionment", impact: 980, conf: 0.86, status: "accepted" },
  { client: "The Iron Skillet Restaurants Ltd.", category: "Quick method", title: "Quick method election worth modeling", impact: 940, conf: 0.71, status: "review" },
  { client: "Sarah Williams", category: "T776", title: "CCA election deferral on rental", impact: 0, conf: 0.88, status: "review", note: "Defer for future utility" },
  { client: "Margaret Chen", category: "Spousal", title: "Transfer medical to Daniel", impact: 134, conf: 0.95, status: "accepted" },
];

// --- Reconciliation ---
export const reconciliation = {
  bankBalance: 47820.16, ledgerBalance: 46198.42, cleared: 41,
  outstanding: [
    { date: "2026-04-30", desc: "Cheque #1042 — Bell Canada", amount: -89.99, type: "outstanding cheque", suggestion: "auto-match" },
    { date: "2026-04-29", desc: "Deposit — Inv 1043", amount: 1850.00, type: "deposit in transit", suggestion: "auto-match" },
    { date: "2026-04-28", desc: "Bank fee — overdraft", amount: -45.00, type: "missing entry", suggestion: "create JE: Bank fees" },
    { date: "2026-04-27", desc: "Interest income", amount: 12.41, type: "missing entry", suggestion: "create JE: Interest income" },
    { date: "2026-04-26", desc: "Cheque #1038 — payee unknown", amount: -340.00, type: "duplicate?", suggestion: "review — same amt as cheque #1037" },
  ],
};

// --- GST / HST ---
export const gstClient = { name: "Riverside Plumbing Inc.", period: "Q1 2026 (Jan – Mar)", filingFreq: "Quarterly", province: "ON" };
export const gstSummary = {
  collected: 14200, itc: 4380, adjustments: 0, netOwing: 9820, dueDate: "2026-04-30", paid: false,
  driftPct: 4.1,
};
export const gstFilingHistory = [
  { period: "Q4 2025", filed: "2026-01-28", net: 8120, status: "filed" },
  { period: "Q3 2025", filed: "2025-10-25", net: 7440, status: "filed" },
  { period: "Q2 2025", filed: "2025-07-24", net: 6890, status: "filed" },
  { period: "Q1 2025", filed: "2025-04-28", net: 7210, status: "filed" },
];
export const gstBreakdown = [
  { line: "Total revenue (line 101)", amount: 109231 },
  { line: "GST/HST collected (line 105)", amount: 14200 },
  { line: "Adjustments (line 107)", amount: 0 },
  { line: "Total ITCs (line 108)", amount: 4380 },
  { line: "Adjustments to ITCs (line 110)", amount: 0 },
  { line: "Net tax (line 109)", amount: 9820 },
];

// --- Payroll: employees ---
export const employees = [
  { id: "e1", name: "Joe MacDonald", role: "Owner / Plumber", rate: "$85k salary", type: "Salary", td1: "TD1 ✓", vacAccrued: 12.4, lastPaid: "2026-04-26", status: "active" },
  { id: "e2", name: "Aisha Patel", role: "Apprentice plumber", rate: "$28/hr", type: "Hourly", td1: "TD1 ✓", vacAccrued: 38.2, lastPaid: "2026-04-26", status: "active" },
  { id: "e3", name: "Marcus Lee", role: "Office admin", rate: "$24/hr", type: "Hourly", td1: "TD1 ✓", vacAccrued: 26.0, lastPaid: "2026-04-26", status: "active" },
  { id: "e4", name: "Priya Singh", role: "Plumber", rate: "$36/hr", type: "Hourly", td1: "missing", vacAccrued: 14.8, lastPaid: "2026-04-26", status: "active" },
  { id: "e5", name: "Tom Reilly", role: "Helper", rate: "$22/hr", type: "Hourly", td1: "TD1 ✓", vacAccrued: 0, lastPaid: "2026-03-15", status: "ROE pending" },
];
export const payrollKpis = [
  { label: "Payroll (MTD)", value: "$24,820", sub: "5 employees", tone: "neutral" as const },
  { label: "Source deductions due", value: "$8,140", sub: "PD7A · May 15", tone: "warn" as const },
  { label: "ROEs to file", value: "1", sub: "Tom Reilly", tone: "warn" as const },
  { label: "TD1 missing", value: "1", sub: "Priya Singh", tone: "danger" as const },
];

// --- Pay run ---
export const payRunMeta = { period: "Apr 14 – Apr 27, 2026", payDate: "2026-04-30", frequency: "Bi-weekly" };
export const payRunRows = [
  { name: "Joe MacDonald", hours: 80, gross: 3269.23, fed: 542.18, prov: 215.43, cpp: 175.20, ei: 53.79, other: 0, net: 2282.63 },
  { name: "Aisha Patel", hours: 76, gross: 2128.00, fed: 280.42, prov: 112.18, cpp: 109.42, ei: 35.01, other: 0, net: 1590.97 },
  { name: "Marcus Lee", hours: 80, gross: 1920.00, fed: 232.20, prov: 92.40, cpp: 96.84, ei: 31.59, other: 0, net: 1466.97 },
  { name: "Priya Singh", hours: 82, gross: 2952.00, fed: 446.82, prov: 178.43, cpp: 156.40, ei: 48.57, other: 0, net: 2121.78 },
];
export const payRunChecks = [
  { label: "Hours imported from time tracker", done: true },
  { label: "TD1 elections current", done: false, note: "Priya Singh missing" },
  { label: "CPP / EI exemption checks", done: true },
  { label: "Direct deposit info on file", done: true },
  { label: "AI sanity check passed", done: true, note: "no anomalies vs prior 4 runs" },
  { label: "Manager approval", done: false },
];

// --- Year-end slips ---
export const slipKpis = [
  { label: "Employees", value: "5", sub: "active + 1 ROE", tone: "neutral" as const },
  { label: "T4 generated", value: "5/5", sub: "all reconciled to GL", tone: "success" as const },
  { label: "Variance vs GL", value: "$0.00", sub: "balanced", tone: "success" as const },
  { label: "CRA submission", value: "Ready", sub: "XML built", tone: "ai" as const },
];
export const slipRows = [
  { name: "Joe MacDonald", b14: 85000.00, b16: 4055.50, b18: 1077.48, b22: 14180.40, b24: 65300, b26: 65300, status: "ready" },
  { name: "Aisha Patel", b14: 55216.00, b16: 2841.43, b18: 906.70, b22: 7012.60, b24: 55216, b26: 55216, status: "ready" },
  { name: "Marcus Lee", b14: 49920.00, b16: 2517.84, b18: 820.61, b22: 5982.40, b24: 49920, b26: 49920, status: "ready" },
  { name: "Priya Singh", b14: 76752.00, b16: 4055.50, b18: 1262.78, b22: 11420.30, b24: 68500, b26: 68500, status: "warning" },
  { name: "Tom Reilly", b14: 14080.00, b16: 696.96, b18: 231.55, b22: 1408.00, b24: 14080, b26: 14080, status: "ROE filed" },
];

// --- Knowledge assistant chat ---
export const chatThread = [
  { role: "user" as const, content: "Client (sole prop) wants to deduct lunch with a referral source. Are these meals 50% deductible or fully?", time: "10:42 AM" },
  {
    role: "assistant" as const,
    time: "10:42 AM",
    content: `Generally **50% deductible** under ITA s.67.1.

Meals & entertainment expenses are limited to 50% of the lesser of (a) the amount paid and (b) what is reasonable in the circumstances, regardless of who the meal is with — clients, prospects, referral sources, or staff.

There are exceptions where 100% applies:
- Meals at a fundraising event for a registered charity
- Bills for transportation, food and entertainment included in a long-haul truck driver's eligible travel period
- Cost of food/beverages provided to all employees at a particular work site (max 6 events/year)
- Entertainment that is the business itself (e.g., a restaurant)

For a referral lunch, none of these exceptions apply — claim at 50%.`,
    citations: [
      { source: "ITA s.67.1(1)", note: "50% limitation" },
      { source: "ITA s.67.1(2)", note: "exceptions to limitation" },
      { source: "Folio S2-F3-C2", note: "Benefits and Allowances Received from Employment, ¶2.39" },
    ],
  },
  { role: "user" as const, content: "What if the client gives the meal as a gift card to the referral source instead?", time: "10:44 AM" },
  {
    role: "assistant" as const,
    time: "10:44 AM",
    content: `Then it shifts category — likely **promotion/advertising (100% deductible)** rather than M&E, but with caveats.

A gift card given to a non-employee referral source is generally treated as a promotional expense under s.18(1)(a) and not subject to the s.67.1 50% rule, *because* s.67.1 hinges on "human consumption of food or beverages" by the taxpayer or for entertainment. A gift card itself is not consumption.

**Watch outs:**
- If the gift card is restaurant-specific and clearly intended to be redeemed for food, CRA may recharacterize and apply the 50% rule (CRA Document 2010-0354491E5).
- T4A reporting may be triggered if total cards to a single individual exceed $500/year (per CRA's administrative position on gifts/awards, though that's an *employee* policy — for non-employees, treat any gift card > $50 as taxable to the recipient and consider T4A).
- Reasonableness limit under s.67 still applies.

Recommend: keep value modest, document business purpose, prefer non-restaurant-specific cards.`,
    citations: [
      { source: "ITA s.18(1)(a)", note: "general deduction limitation" },
      { source: "CRA 2010-0354491E5", note: "characterization of gift cards" },
      { source: "Firm memo 2024-MEMO-014", note: "internal guidance on referral incentives" },
    ],
  },
];

// --- Email drafts ---
export const emailDrafts = [
  { id: "e1", client: "Margaret Chen", subject: "We still need 2 items to file your 2025 return", type: "Missing info request", status: "draft", time: "12 min ago", body: "Hi Margaret,\n\nThanks for sending over your slip package — we're nearly ready to file your 2025 T1.\n\nTwo items still outstanding:\n  1. T5 from Tangerine ($340 interest) — this appears on CRA's records but isn't in your uploaded documents. You can grab it from your Tangerine online banking under Tax Documents.\n  2. Your 2025 RRSP contribution slip from Sun Life — we have receipts up to Dec 31, but we'd like to confirm whether you made any first-60-days contributions (Jan – Feb 2026) you'd like applied to 2025.\n\nOnce we have those, we'll send the final return for your signature.\n\nBest,\nSarah" },
  { id: "e2", client: "David Thompson", subject: "Your 2025 NOA — what it means", type: "NOA explanation", status: "draft", time: "1 hour ago", body: "Hi David,\n\nCRA has assessed your 2025 return. The NOA matches what we filed with one small adjustment — they applied a $43 GST credit you weren't expecting (based on your income level). No action needed on your end.\n\nKey numbers:\n  • Refund: $1,247 — direct-deposit to your RBC chequing within 8 business days\n  • RRSP room for 2026: $14,820\n  • Carryforward charitable: $0\n\nQuick reminder — your 2026 RRSP contribution window is open. Contact me if you'd like to discuss timing.\n\nBest,\nSarah" },
  { id: "e3", client: "Lakeshore Cafe Ltd.", subject: "GST/HST Q1 — reminder + missing categorizations", type: "Filing reminder", status: "scheduled", time: "queued for tomorrow 9am", body: "Hi Anna,\n\nFriendly heads-up — your GST/HST Q1 filing is due May 7. We're holding on submission because 32 March transactions in your RBC business account are still uncategorized.\n\nMost look like they're from your usual suppliers (Sysco, Restaurant Depot, GFL Environmental). If you can confirm there are no unusual entries, we'll batch-categorize and submit.\n\nOption to expedite: reply 'go ahead' and we'll handle it on our end.\n\nThanks,\nMike" },
  { id: "e4", client: "Riverside Plumbing Inc.", subject: "CRA letter received — review pending", type: "CRA correspondence triage", status: "needs review", time: "yesterday", body: "Hi Joe,\n\nThanks for forwarding the CRA letter. Here's the summary:\n\n  • Letter type: Pre-assessment review of 2024 T2 — line 8910 (motor vehicle expenses)\n  • Deadline to respond: May 22, 2026 (30 days)\n  • What CRA wants: copies of vehicle logs, fuel receipts, and the lease agreement for the 2023 Ford Transit\n\nI've already pulled the supporting docs from your file — they support the 78% business-use claim. I'll draft the response and send for your sign-off this week. No need to do anything on your end.\n\nBest,\nAnita" },
];

// --- Meeting prep ---
export const upcomingMeetings = [
  { time: "Tomorrow 9:30 AM", client: "Margaret Chen", type: "T1 sign-off call", duration: "30 min", prep: "ready" },
  { time: "Tomorrow 11:00 AM", client: "Boreal Tech Inc.", type: "Tax planning — 2026", duration: "60 min", prep: "ready" },
  { time: "Thu 2:00 PM", client: "Lakeshore Cafe Ltd.", type: "Quarterly review", duration: "45 min", prep: "drafting" },
  { time: "Fri 10:00 AM", client: "Patel Family Trust", type: "T3 intake", duration: "30 min", prep: "ready" },
];
export const meetingBrief = {
  client: "Boreal Tech Inc.",
  time: "Tomorrow, 11:00 AM (60 min)",
  attendees: ["Anita R (partner)", "Sarah K (preparer)", "Jordan M (CEO, client)", "Erin S (CFO, client)"],
  context: "Annual tax planning conversation. Last met Q4 2025 to discuss SR&ED and salary/dividend mix. Client is post-Series A, $4.2M ARR, 18 FTEs.",
  openItems: [
    { label: "$24,500 expiring SR&ED ITCs", note: "Must claim on 2025 T2 or lose them in 2027", urgency: "high" },
    { label: "2026 sal/div mix for Jordan & Erin", note: "AI suggests $58k salary + $122k dividends each — saves $5,200 vs current", urgency: "med" },
    { label: "T4A for contractor — Markus Bahr", note: "$48,200 paid, T4A overdue (was due Feb 28)", urgency: "high" },
    { label: "Stock option plan for new hires", note: "Client mentioned in Q1 — discuss CCPC ESPP rules", urgency: "low" },
  ],
  recentActivity: [
    "Q1 GST filed — $4,820 net owing, paid",
    "March bookkeeping reconciled, no anomalies",
    "Series A SAFE conversion — capital structure updated",
  ],
  talkingPoints: [
    "Open with SR&ED — biggest dollar item, time-sensitive.",
    "Walk through optimization sweep results ($29,700 total annual benefit).",
    "Surface T4A delinquency and the late-filing penalty math (~$1,200 if filed in next 30 days).",
    "Ask about hiring plans — affects payroll setup and stock plan timing.",
  ],
  financials: [
    { label: "FY25 revenue", value: "$4.2M" },
    { label: "FY25 net income", value: "$612k" },
    { label: "Cash on hand", value: "$2.1M" },
    { label: "Burn / month", value: "$148k" },
  ],
};

// --- Audit risk dashboard ---
export const auditRiskDist = [
  { band: "0-20", count: 28, fill: "#10b981" },
  { band: "21-40", count: 11, fill: "#84cc16" },
  { band: "41-60", count: 5, fill: "#f59e0b" },
  { band: "61-80", count: 2, fill: "#ef4444" },
  { band: "81-100", count: 1, fill: "#b91c1c" },
];
export const highRiskList = [
  { client: "Boreal Tech Inc.", score: 71, type: "T2", drivers: ["SR&ED claim 38% of gross", "Related-party loans", "Foreign software costs"], change: "+8 vs LY" },
  { client: "Lakeshore Cafe Ltd.", score: 62, type: "T2", drivers: ["Cash deposits 42% of revenue", "M&E 8.2% of gross", "Owner compensation high"], change: "+4 vs LY" },
  { client: "The Iron Skillet Restaurants Ltd.", score: 58, type: "T2", drivers: ["Cash sales 38%", "Related-party rent", "Tip allocation method"], change: "+2 vs LY" },
  { client: "Bytewise Software Inc.", score: 52, type: "T2", drivers: ["SR&ED claim large vs revenue", "Stock option plan", "International contractors"], change: "new" },
  { client: "Riverside Plumbing Inc.", score: 47, type: "T2", drivers: ["Vehicle 78% business use", "Home office in T2", "Sub-contractor T5018 gaps"], change: "-3 vs LY" },
  { client: "Aurora Construction Ltd.", score: 44, type: "T2", drivers: ["Vehicles 95%+ business use", "Subcontractor classifications", "Site safety equipment expensing"], change: "+5 vs LY" },
  { client: "Beaver Creek Holdings Ltd.", score: 41, type: "T2", drivers: ["Passive income > $50k threshold", "Inter-co management fees", "Capital dividends declared"], change: "+1 vs LY" },
  { client: "Acme Holdings Ltd.", score: 34, type: "T2", drivers: ["Investment holdco — passive income", "Capital dividends declared", "Inter-co management fees"], change: "+1 vs LY" },
  { client: "Patel Family Trust", score: 28, type: "T3", drivers: ["Beneficiary income allocation", "21-year deemed disposition approaching"], change: "+2 vs LY" },
  { client: "Maple Ridge Dental Corp.", score: 26, type: "T2", drivers: ["Owner-manager comp planning", "Spousal split via dividend sprinkling — TOSI exposure"], change: "0 vs LY" },
  { client: "Sarah Williams", score: 21, type: "T1", drivers: ["First-year rental — CCA", "Moving expense claim"], change: "new" },
];
