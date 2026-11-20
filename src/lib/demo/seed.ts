// Fictional sample data for demo mode. Everything here is invented: merchants, amounts, people.
// Dates are generated relative to today so the dashboard always looks current.
// Deterministic (seeded random), so a reset always gives the same shape of data.

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Tables = Record<string, Row[]>;

export const DEMO_USER = { id: "demo-user", email: "alex@example.com" };
export const DEMO_PARTNER = { id: "demo-partner", email: "sam@example.com" };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spec {
  raw: string; // what the bank shows
  clean: string; // tidied merchant name
  category: string;
  account: string;
  min: number;
  max: number;
}

const AMEX = "Amex Credit Card";
const APPLE = "Apple Card";
const CHECKING = "Joint Checking";

const groceries: Spec[] = [
  { raw: "GREENFIELD MARKET #0412", clean: "Greenfield Market", category: "Groceries", account: AMEX, min: 22, max: 140 },
  { raw: "CORNER CO-OP", clean: "Corner Co-op", category: "Groceries", account: AMEX, min: 14, max: 70 },
  { raw: "HARVEST FOODS 220", clean: "Harvest Foods", category: "Groceries", account: AMEX, min: 40, max: 130 },
];
const eating: Spec[] = [
  { raw: "BLUE DOOR CAFE", clean: "Blue Door Cafe", category: "Food and Drink", account: AMEX, min: 4, max: 14 },
  { raw: "DAILY GRIND COFFEE", clean: "Daily Grind Coffee", category: "Food and Drink", account: AMEX, min: 4, max: 9 },
  { raw: "NOODLE HOUSE", clean: "Noodle House", category: "Food and Drink", account: AMEX, min: 18, max: 46 },
  { raw: "PIZZA LANE", clean: "Pizza Lane", category: "Food and Drink", account: AMEX, min: 22, max: 48 },
  { raw: "SMOKEHOUSE 9", clean: "Smokehouse 9", category: "Food and Drink", account: AMEX, min: 35, max: 82 },
];
const house: Spec[] = [
  { raw: "HOMESTEAD HARDWARE", clean: "Homestead Hardware", category: "House", account: AMEX, min: 12, max: 140 },
  { raw: "LUMBER & LEAF GARDEN", clean: "Lumber & Leaf Garden", category: "House", account: AMEX, min: 20, max: 90 },
];
const gas: Spec[] = [{ raw: "QUICKFILL 3321", clean: "Quickfill", category: "Gas", account: AMEX, min: 32, max: 58 }];
const health: Spec[] = [
  { raw: "EASTSIDE PHARMACY", clean: "Eastside Pharmacy", category: "Health", account: AMEX, min: 8, max: 45 },
  { raw: "BRIGHT SMILE DENTAL", clean: "Bright Smile Dental", category: "Health", account: CHECKING, min: 60, max: 180 },
];
const pets: Spec[] = [{ raw: "PAWS & CLAWS SUPPLY", clean: "Paws & Claws", category: "Pets", account: AMEX, min: 28, max: 70 }];
const fun: Spec[] = [
  { raw: "RIVERSIDE CINEMA", clean: "Riverside Cinema", category: "Entertainment", account: AMEX, min: 14, max: 36 },
  { raw: "PAGE TURNER BOOKS", clean: "Page Turner Books", category: "Entertainment", account: AMEX, min: 12, max: 40 },
];
const alexFun: Spec[] = [
  { raw: "AMAZON MKTPL*2K4", clean: "Amazon", category: "Alex Fun", account: APPLE, min: 12, max: 80 },
  { raw: "SUMMIT CLIMBING GYM", clean: "Summit Climbing Gym", category: "Alex Fun", account: APPLE, min: 25, max: 65 },
  { raw: "SPINNING RECORD SHOP", clean: "Spinning Record Shop", category: "Alex Fun", account: APPLE, min: 18, max: 42 },
];
const samFun: Spec[] = [
  { raw: "STUDIO 9 CERAMICS", clean: "Studio 9 Ceramics", category: "Sam Fun", account: AMEX, min: 30, max: 60 },
  { raw: "FIBER & THREAD SUPPLY", clean: "Fiber & Thread", category: "Sam Fun", account: AMEX, min: 15, max: 55 },
  { raw: "TRAIL RUNNING CO", clean: "Trail Running Co", category: "Sam Fun", account: AMEX, min: 45, max: 110 },
];

const fixed = (raw: string, clean: string, category: string, day: number, amount: number, account = CHECKING) => ({ raw, clean, category, day, amount, account });
const bills = [
  fixed("MAPLE PROPERTY MGMT", "Maple Property Mgmt", "Bills", 1, 2150),
  fixed("EVERGREEN POWER & LIGHT", "Evergreen Power & Light", "Bills", 8, 112),
  fixed("NORTHLINK FIBER", "Northlink Fiber", "Bills", 12, 70),
  fixed("ORBIT MOBILE", "Orbit Mobile", "Bills", 15, 85),
  fixed("SHIELD AUTO INSURANCE", "Shield Auto Insurance", "Bills", 20, 132),
  fixed("CLOUDLOCKER 200GB", "Cloudlocker", "Subscription", 3, 2.99),
  fixed("STREAMBOX", "Streambox", "Subscription", 5, 15.99),
  fixed("TUNEHIVE", "Tunehive", "Subscription", 9, 10.99),
];

// Monthly targets (the "Targets" tab of the sheet). A later column replaces an earlier one entirely.
const TARGETS_OLD: Record<string, number> = {
  "Food and Drink": 450, Groceries: 650, House: 300, Travel: 400, "Alex Fun": 200, "Sam Fun": 200,
  "Bills + Subscription": 2650, Gas: 150, Health: 120, Pets: 100, Entertainment: 100,
};
const TARGETS_NEW: Record<string, number> = { ...TARGETS_OLD, Groceries: 720, "Food and Drink": 400, Entertainment: 120 };

export function buildSeed(now = new Date()): Tables {
  const rand = rng(20260);
  const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  const txs: Row[] = [];
  let n = 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const monthStarts: Date[] = [];
  for (let i = 5; i >= 0; i--) monthStarts.push(new Date(today.getFullYear(), today.getMonth() - i, 1));

  monthStarts.forEach((ms, idx) => {
    const y = ms.getFullYear();
    const m = ms.getMonth() + 1;
    const month = iso(y, m, 1);
    const isCurrent = idx === monthStarts.length - 1;
    const dim = new Date(y, m, 0).getDate();
    const lastDay = isCurrent ? today.getDate() : dim;

    const add = (day: number, raw: string, clean: string, category: string, account: string, amount: number, extra: Row = {}) => {
      if (day > lastDay || day < 1) return;
      n += 1;
      txs.push({
        id: `demo-${y}${pad(m)}-${String(n).padStart(4, "0")}`,
        source: "transactions",
        account,
        posted_on: iso(y, m, day),
        month,
        summary: raw,
        merchant: raw,
        clean_merchant: clean,
        category,
        amount,
        is_pending: isCurrent && day >= today.getDate() - 1 && amount < 0 && category !== "Bills" && category !== "Subscription",
        last_seen_run: 1,
        ...extra,
      });
    };

    const spend = (specs: Spec[], count: number) => {
      for (let i = 0; i < count; i++) {
        const s = pick(specs);
        add(1 + Math.floor(rand() * dim), s.raw, s.clean, s.category, s.account, -between(s.min, s.max));
      }
    };

    // Money in and money moving around (excluded from spending by default).
    add(1, "ACME CO PAYROLL", "Acme Co Payroll", "Income", CHECKING, 3200, { bank_category: "Income" });
    add(15, "ACME CO PAYROLL", "Acme Co Payroll", "Income", CHECKING, 3200, { bank_category: "Income" });
    add(2, "TRANSFER TO SAVINGS", "Transfer to Savings", "Transfer", CHECKING, -500, { bank_category: "Transfer" });
    add(21, "CREDIT CARD PAYMENT THANK YOU", "Credit Card Payment", "Credit Card Payment", CHECKING, -1800, { bank_category: "Credit Card Payment" });
    add(22, "CREDIT CARD PAYMENT THANK YOU", "Credit Card Payment", "Credit Card Payment", AMEX, 1800, { bank_category: "Credit Card Payment" });

    for (const b of bills) {
      const wiggle = b.category === "Bills" && b.raw.startsWith("EVERGREEN") ? between(-18, 24) : 0;
      add(b.day, b.raw, b.clean, b.category, b.account, -Math.round((b.amount + wiggle) * 100) / 100);
    }

    spend(groceries, 8 + Math.floor(rand() * 3));
    spend(eating, 13 + Math.floor(rand() * 5));
    spend(house, 2 + Math.floor(rand() * 3));
    spend(gas, 3 + Math.floor(rand() * 2));
    spend(health, 1 + Math.floor(rand() * 2));
    spend(pets, 1 + Math.floor(rand() * 2));
    spend(fun, 2 + Math.floor(rand() * 2));
    spend(alexFun, 4 + Math.floor(rand() * 3));
    spend(samFun, 3 + Math.floor(rand() * 3));

    // A couple of trips, so the Travel tile has something to show.
    if (idx === 1 || idx === 3) {
      add(6, "SKYLINE AIRWAYS", "Skyline Airways", "Travel", AMEX, -between(310, 460));
      add(9, "HARBORVIEW INN", "Harborview Inn", "Travel", AMEX, -between(240, 330));
      add(10, "RENTAL CARS 42", "Rental Cars 42", "Travel", AMEX, -between(90, 150));
    }

    // Charges nobody has categorized yet: these show up in the app's Inbox.
    if (idx >= monthStarts.length - 2) {
      add(7, "PAYPAL *JJSUPPLY", "PayPal JJSupply", "Uncategorized", AMEX, -34.2);
      add(11, "CITY PARKING 55", "City Parking", "Uncategorized", CHECKING, -9);
      if (!isCurrent) add(18, "UNKNOWN MERCH 8841", "Unknown Merchant", "Uncategorized", AMEX, -27.45);
    }
  });

  const monthKey = (offset: number) => iso(monthStarts[offset].getFullYear(), monthStarts[offset].getMonth() + 1, 1);
  const targets: Row[] = [];
  for (const [category, amount] of Object.entries(TARGETS_OLD)) targets.push({ category, effective_month: monthKey(0), amount });
  for (const [category, amount] of Object.entries(TARGETS_NEW)) targets.push({ category, effective_month: monthKey(3), amount });

  const stamp = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000).toISOString();
  const thisMonth = monthKey(5);
  const lastMonth = monthKey(4);

  return {
    transactions: txs,
    targets,
    sync_runs: [{ id: 1, status: "ok", finished_at: stamp(18) }],
    vendor_rules: [
      { id: 1, match_type: "contains", pattern: "amazon", category: "House", accounts: [], amount: null },
      { id: 2, match_type: "contains", pattern: "amazon", category: "Alex Fun", accounts: [APPLE], amount: null },
      { id: 3, match_type: "contains", pattern: "amazon", category: "Sam Fun", accounts: [AMEX], amount: null },
    ],
    month_locks: [],
    app_settings: [
      { key: `display_name:${DEMO_USER.id}`, value: "Alex", updated_at: stamp(9000) },
      { key: `display_name:${DEMO_PARTNER.id}`, value: "Sam", updated_at: stamp(9000) },
    ],
    month_notes: [
      { id: 1, month: lastMonth, body: "Travel ran over because of the flights. Worth raising the target before the next trip.", author_id: DEMO_PARTNER.id, author_email: DEMO_PARTNER.email, created_at: stamp(60 * 24 * 14) },
      { id: 2, month: thisMonth, body: "Cancel the second streaming service, then re-check the Bills + Subscription total.", author_id: DEMO_USER.id, author_email: DEMO_USER.email, created_at: stamp(60 * 30) },
    ],
    apple_imports: [],
    push_subscriptions: [],
  };
}
