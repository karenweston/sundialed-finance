import { describe, expect, it } from "vitest";
import {
  applyMonthlyCategories,
  isMonthTab,
  parseMonthlyCategories,
  buildVendorLookup,
  classifyTransfer,
  markTransfers,
  parseAccounts,
  parseAppleCard,
  parseDate,
  parseMoney,
  parseTargets,
  parseTransactions,
  parseVendorMap,
} from "./parse.ts";
import type { TransactionRow } from "./parse.ts";

// All values below are invented. They only mimic the shape of the real Sheet tabs.

describe("parseMoney", () => {
  it("handles commas, currency, parentheses, percents and junk", () => {
    expect(parseMoney("1,509.38")).toBe(1509.38);
    expect(parseMoney("$12")).toBe(12);
    expect(parseMoney("(45.10)")).toBe(-45.1);
    expect(parseMoney("-10.86")).toBe(-10.86);
    expect(parseMoney("18.99%")).toBe(18.99);
    expect(parseMoney("#REF!")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("parseDate", () => {
  it("normalizes both date styles", () => {
    expect(parseDate("2025-12-26 15:08:04")).toBe("2025-12-26");
    expect(parseDate("03/30/2026")).toBe("2026-03-30");
    expect(parseDate("3/1/2026")).toBe("2026-03-01");
    expect(parseDate("nope")).toBeNull();
  });
});

const vendorRows = [
  [],
  // The real tab leaves column A empty, so everything starts in column B.
  ["", "Merchant Name", "Clean Merchant Name", "Simple", "Memo"],
  ["", "COFFEE SHOP #12", "Corner Coffee", "Dining"],
  ["", "coffee shop #12", "Dup, ignored", "Other"],
  ["", "BIG STORE 0042", "Big Store", "Groceries"],
];

describe("vendor mapping", () => {
  it("keeps the first mapping per merchant and looks up case-insensitively", () => {
    const vendors = parseVendorMap(vendorRows);
    expect(vendors).toHaveLength(2);
    const lookup = buildVendorLookup(vendors);
    expect(lookup.get("coffee shop #12")?.category).toBe("Dining");
  });
});

const txHeader = ["ID", "Account ID", "Account", "Date", "Month", "Summary", "Merchant", "Amount", "Currency", "Is Pending?", "Original Description"];
const lookup = buildVendorLookup(parseVendorMap(vendorRows));

describe("parseTransactions", () => {
  it("maps categories, keeps sign, skips placeholder and bad rows", async () => {
    const rows = [
      txHeader,
      ["---"],
      ["t1", "a1", "Checking", "2026-10-03 09:00:00", "10/1/2026", "COFFEE SHOP #12", "Coffee Shop", "-4.50", "USD", "FALSE", "x"],
      ["t2", "a1", "Checking", "2026-10-04 09:00:00", "10/1/2026", "Mystery", "Mystery", "(20.00)", "USD", "TRUE", "x"],
      ["t3", "a1", "Checking", "", "", "No date", "", "5", "USD", "FALSE", ""],
    ];
    const out = await parseTransactions(rows, lookup);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "t1", category: "Dining", clean_merchant: "Corner Coffee", amount: -4.5, month: "2026-10-01", is_pending: false });
    expect(out[1]).toMatchObject({ category: "Uncategorized", amount: -20, is_pending: true });
  });
  it("throws a clear error if the header is missing", async () => {
    await expect(parseTransactions([["nothing"]], lookup)).rejects.toThrow(/Header row/);
  });
});

describe("parseAppleCard", () => {
  const header = ["ID", "Account ID", "Account", "Date", "Month", "Summary", "Merchant", "Amount"];
  it("flips the sign and gives repeated identical rows distinct stable ids", async () => {
    const rows = [
      header,
      ["", "APC", "Apple Card", "03/30/2026", "3/1/2026", "BIG STORE 0042", "Big Store", "88.92"],
      ["", "APC", "Apple Card", "03/30/2026", "3/1/2026", "BIG STORE 0042", "Big Store", "88.92"],
      ["", "APC", "Apple Card", "03/31/2026", "3/1/2026", "ACH DEPOSIT", "Ach Deposit", "-769.41"],
    ];
    const a = await parseAppleCard(rows, lookup);
    const b = await parseAppleCard(rows, lookup);
    expect(a.map((r) => r.amount)).toEqual([-88.92, -88.92, 769.41]);
    expect(a[0].category).toBe("Groceries");
    expect(new Set(a.map((r) => r.id)).size).toBe(3);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });
});

describe("parseAccounts", () => {
  it("parses balances and skips the placeholder row", () => {
    const rows = [
      ["ID", "Name", "Mask", "Account Type", "Current Balance", "Account Limit", "Liability Interest Rate", "Next Payment Due Date"],
      ["---"],
      ["acc1", "Checking", "9999", "depository", "3,275.41", "", "", ""],
      ["acc2", "Card", "1234", "credit", "156.36", "40,500.00", "20.99%", "2026-10-28"],
    ];
    const out = parseAccounts(rows);
    expect(out).toHaveLength(2);
    expect(out[0].current_balance).toBe(3275.41);
    expect(out[1]).toMatchObject({ credit_limit: 40500, interest_rate: 20.99, next_payment_due: "2026-10-28" });
  });
});

describe("parseTargets", () => {
  it("turns each month column into an effective-from target", () => {
    const rows = [
      ["TARGETS", "Jan", "Feb", "April", "October"],
      ["Groceries", "500", "500", "450", "400"],
      ["", "1", "1", "1", "1"],
      ["House", "1,000", "2,000", "", "750"],
    ];
    const out = parseTargets(rows, 2026);
    expect(out).toContainEqual({ category: "Groceries", effective_month: "2026-04-01", amount: 450 });
    expect(out).toContainEqual({ category: "House", effective_month: "2026-02-01", amount: 2000 });
    expect(out.find((t) => t.category === "House" && t.effective_month === "2026-04-01")).toBeUndefined();
    expect(out.filter((t) => t.category === "")).toHaveLength(0);
  });
});

describe("parseTargets total row", () => {
  it("skips the Total row", () => {
    const out = parseTargets([["TARGETS", "Jan"], ["Groceries", "500"], ["Total", "500"]], 2026);
    expect(out).toEqual([{ category: "Groceries", effective_month: "2026-01-01", amount: 500 }]);
  });
});

describe("transfers and card payments", () => {
  it("recognizes the bank's transfer and card-payment labels, and nothing broader", () => {
    expect(classifyTransfer("TRANSFER_OUT_ACCOUNT_TRANSFER", [])).toBe("Transfers");
    expect(classifyTransfer("transfer_in_savings", [])).toBe("Transfers");
    expect(classifyTransfer("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", [])).toBe("Credit Card Payment");
    // left for a person to decide
    for (const c of ["TRANSFER_OUT_OTHER_TRANSFER_OUT", "TRANSFER_IN_DEPOSIT", "LOAN_PAYMENTS_MORTGAGE_PAYMENT", "FOOD_AND_DRINK_COFFEE", null, ""]) {
      expect(classifyTransfer(c, ["Some Shop"])).toBeNull();
    }
  });
  it("recognizes Apple Card payments from the bank by their text", () => {
    expect(classifyTransfer(null, ["ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1"])).toBe("Transfers");
  });

  const header = ["ID", "Account", "Date", "Summary", "Merchant", "Amount", "Is Pending?", "Category ID"];
  it("keeps the bank label on the row and categorizes only via Vendor Mapping", async () => {
    const rows = [
      header,
      ["t1", "Checking", "2026-10-03", "ONLINE TRANSFER", "Online Transfer", "-500", "FALSE", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
      ["t2", "Checking", "2026-10-04", "COFFEE SHOP #12", "Coffee Shop", "-4.5", "FALSE", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
    ];
    const out = await parseTransactions(rows, lookup);
    expect(out.map((r) => r.category)).toEqual(["Uncategorized", "Dining"]);
    expect(out[0].bank_category).toBe("TRANSFER_OUT_ACCOUNT_TRANSFER");
  });

  const tx = (id: string, account: string, posted_on: string, amount: number, bank_category: string | null, category = "Uncategorized", summary: string | null = null): TransactionRow => ({
    id, source: "transactions", account, posted_on, month: `${posted_on.slice(0, 7)}-01`, summary, merchant: null,
    clean_merchant: null, category, bank_category, amount, is_pending: false,
  });
  it("labels a transfer only when the other half is in another known account", () => {
    const out = markTransfers([
      tx("a", "Checking", "2026-10-03", -500, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      tx("b", "Savings", "2026-10-04", 500, "TRANSFER_IN_ACCOUNT_TRANSFER"),
      tx("c", "Checking", "2026-10-06", -40, "TRANSFER_OUT_ACCOUNT_TRANSFER"), // no other half
      tx("d", "Checking", "2026-10-07", -25, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      tx("e", "Checking", "2026-10-07", 25, "TRANSFER_IN_ACCOUNT_TRANSFER"), // same account
      tx("f", "Checking", "2026-10-01", -90, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      tx("g", "Savings", "2026-10-20", 90, "TRANSFER_IN_ACCOUNT_TRANSFER"), // too far apart
    ]);
    expect(out.map((r) => r.category)).toEqual([
      "Transfers", "Transfers", "Uncategorized", "Uncategorized", "Uncategorized", "Uncategorized", "Uncategorized",
    ]);
  });
  it("pairs card payments across the bank and the card, and never overrides a mapping", () => {
    const out = markTransfers([
      tx("a", "Checking", "2026-10-05", -300, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
      tx("b", "Card", "2026-10-06", 300, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
      tx("c", "Checking", "2026-10-08", -70, "TRANSFER_OUT_ACCOUNT_TRANSFER", "Gifts"),
      tx("d", "Savings", "2026-10-08", 70, "TRANSFER_IN_ACCOUNT_TRANSFER"),
    ]);
    expect(out.map((r) => r.category)).toEqual(["Credit Card Payment", "Credit Card Payment", "Gifts", "Uncategorized"]);
  });
  it("uses each half once", () => {
    const out = markTransfers([
      tx("a", "Checking", "2026-10-03", -50, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      tx("b", "Checking", "2026-10-03", -50, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      tx("c", "Savings", "2026-10-03", 50, "TRANSFER_IN_ACCOUNT_TRANSFER"),
    ]);
    expect(out.filter((r) => r.category === "Transfers")).toHaveLength(2);
  });
  it("pairs an Apple Card payment with its bank debit by text", async () => {
    const card = await parseAppleCard([
      ["ID", "Account ID", "Account", "Date", "Month", "Summary", "Merchant", "Amount"],
      ["", "APC", "Apple Card", "03/31/2026", "3/1/2026", "ACH DEPOSIT INTERNET TRANSF...", "Ach Deposit Internet Transf...", "-769.41"],
    ], lookup);
    expect(card[0].category).toBe("Uncategorized");
    const out = markTransfers([...card, tx("x", "Checking", "2026-03-30", -769.41, "TRANSFER_OUT_ACCOUNT_TRANSFER")]);
    expect(out.map((r) => r.category)).toEqual(["Transfers", "Transfers"]);
  });
});

describe("month tab categories", () => {
  // Day 46310 is 2026-10-15 in Sheets' serial-number dates.
  const header = [null, null, null, null, "Category", ...Array(10).fill(null), "Account", "Summary", "Date", "Amount"];
  const monthRow = (cat: string | null, acct: string, summary: string, serial: number, amount: number) => [
    null, null, null, null, cat, ...Array(10).fill(null), acct, summary, serial, amount,
  ];
  const tx = (id: string, summary: string, amount: number, posted_on = "2026-10-15", category = "Transportation"): TransactionRow => ({
    id, source: "transactions", account: "Sapphire Credit Card", posted_on, month: "2026-10-01", summary, merchant: summary,
    clean_merchant: summary, category, bank_category: null, amount, is_pending: false,
  });

  it("only treats 'MonthYYYY' tabs as month tabs", () => {
    expect(isMonthTab("October2026")).toBe(true);
    expect(isMonthTab("Avgs2026")).toBe(false);
    expect(isMonthTab("Vendor Mapping")).toBe(false);
  });

  it("a category typed in the month tab replaces the vendor-mapping category", () => {
    const cats = parseMonthlyCategories({
      October2026: [header, monthRow("Reimbursement", "Sapphire Credit Card", "Lyft", 46310.83, -172.85)] as never,
    });
    const [a, b] = applyMonthlyCategories([tx("1", "Lyft", -172.85), tx("2", "Lyft", -5)], cats);
    expect(a.category).toBe("Reimbursement");
    expect(b.category).toBe("Transportation"); // different amount: untouched
  });

  it("lines up duplicate-looking rows in order, and ignores blanks and errors", () => {
    const cats = parseMonthlyCategories({
      October2026: [
        header,
        monthRow("House", "Sapphire Credit Card", "Amazon", 46310, -10),
        monthRow("#N/A", "Sapphire Credit Card", "Amazon", 46310, -10),
        monthRow(null, "Sapphire Credit Card", "Gap", 46310, -3),
      ] as never,
    });
    const out = applyMonthlyCategories([tx("1", "Amazon", -10), tx("2", "Amazon", -10), tx("3", "Gap", -3)], cats);
    expect(out.map((t) => t.category)).toEqual(["House", "Transportation", "Transportation"]);
  });
});
