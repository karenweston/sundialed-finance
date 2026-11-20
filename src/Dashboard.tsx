import { useEffect, useMemo, useRef, useState } from "react";
import Notes from "./Notes";
import type { Note } from "./lib/data";
import SpendChart from "./SpendChart";
import Ring from "./Ring";
import { isHidden, money0, money2, pct } from "./lib/privacy";
import { InboxPage, InboxRow } from "./Inbox";
import Settings from "./Settings";
import {
  canonical, dayLabel, percentOf, isOffLimits, RETIRED, effectiveExcluded, monthKeyOf, monthLabel, budgetRows, splitKey, KEY_CATEGORIES, norm, summarize, targetBreakdown, tone,
} from "./lib/budget";
import type { CategoryRow, ExcludeChoices, Target, Tx } from "./lib/budget";
import {
  UNCATEGORIZED, accountBreakdown, applyRules, buildSnapshot, isMissingTable, previewMatches, uncategorizedGroups,
} from "./lib/rules";
import type { LockSnapshot, MatchType, MonthLock, Rule } from "./lib/rules";

interface Props {
  notes: Note[];
  names: Record<string, string>;
  uid: string | null;
  onAddNote: (month: string, body: string) => Promise<void>;
  onDeleteNote: (id: number) => Promise<void>;
  onSaveName: (name: string) => Promise<void>;
  onSyncNow?: () => Promise<boolean>;
  onToggleHide: () => void;
  subtitle?: React.ReactNode; // the line under the month, e.g. when the data last synced
  onSaveTarget: (category: string, month: string, amount: number | null) => Promise<void>;
  txs: Tx[];
  targets: Target[];
  rules: Rule[];
  locks: MonthLock[];
  hiddenMonths: string[];
  tileCategories: string[] | null;
  onSaveTiles: (categories: string[]) => Promise<void>;
  budgetOrder: string[];
  onSaveOrder: (names: string[]) => Promise<void>;
  savedChoices: ExcludeChoices | null;
  onSaveChoices: (choices: ExcludeChoices) => Promise<void>;
  onSetHiddenMonths: (months: string[]) => Promise<void>;
  onAddRule: (type: MatchType, pattern: string, category: string, accounts: string[], amount: number | null) => Promise<number>;
  onUpdateRule: (id: number, type: MatchType, pattern: string, category: string, accounts: string[], amount: number | null) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
  onLock: (month: string, snapshot: LockSnapshot) => Promise<void>;
  onUnlock: (month: string) => Promise<void>;
  now?: Date; // injectable for previews and tests
}

const STORE = "sundialed.excluded";
// Saved per device. The old format was just a list of excluded categories.
function loadChoices(): ExcludeChoices {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (Array.isArray(raw)) return { off: raw.filter((x) => typeof x === "string"), on: [] };
    if (raw && Array.isArray(raw.off) && Array.isArray(raw.on)) return { off: raw.off, on: raw.on };
  } catch { /* unavailable or unreadable */ }
  return { off: [], on: [] };
}

/** The up-and-down chevrons iOS uses for "pick from a list". */
function ChevronsIcon() {
  return (
    <svg className="caret" viewBox="0 0 12 18" width="12" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7 6 3.5 9.5 7M2.5 11 6 14.5 9.5 11" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 20 20 4" />}
    </svg>
  );
}

function LockIcon({ closed }: { closed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d={closed ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"} />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function KeyTile({ row, onOpen }: { row: CategoryRow; onOpen: (category: string) => void }) {
  const { spent, target } = row;
  const left = target != null ? target - spent : null;
  return (
    <li className={`tile ${target != null && isOffLimits(spent, target) ? "locked" : ""}`}>
      <button className="tile-hit" onClick={() => onOpen(row.category)} aria-label={`See ${row.category} transactions`} />
      <div className="tile-text">
        <div className="tile-name">{row.category}</div>
        <div className="tile-amt">{isHidden() ? (target ? pct(spent, target) : "—") : money0(spent)}</div>
        <div className={`tile-note ${left != null && left < 0 ? "over" : ""}`}>
          {left == null ? "No target" : isHidden() ? (left < 0 ? "▲ over" : "used") : left < 0 ? `▲ ${money0(-left)} over` : `${money0(left)} left`}
        </div>
      </div>
      {target != null && target > 0 && <Ring spent={spent} target={target} size={48} />}
    </li>
  );
}

export default function Dashboard({ txs, targets, rules, locks, hiddenMonths: hidden, onSetHiddenMonths, tileCategories, onSaveTiles, budgetOrder, onSaveOrder, savedChoices, onSaveChoices, onAddRule, onUpdateRule, onDeleteRule, onLock, onUnlock, onSyncNow, onToggleHide, subtitle, onSaveTarget, now, notes, names, uid, onAddNote, onDeleteNote, onSaveName }: Props) {
  const today = useMemo(() => now ?? new Date(), [now]);
  const thisMonth = monthKeyOf(today);

  const months = useMemo(() => {
    const s = new Set(txs.map((t) => t.month));
    s.add(thisMonth);
    return [...s].sort();
  }, [txs, thisMonth]);

  const [monthError, setMonthError] = useState("");
  const [inboxOpen, setInboxOpen] = useState(false);
  const visible = useMemo(() => {
    const v = months.filter((m) => !hidden.includes(m));
    return v.length ? v : months; // never hide everything
  }, [months, hidden]);
  const [picked, setMonth] = useState(thisMonth);
  // If the month being viewed gets hidden, show the nearest visible one.
  const month = visible.includes(picked)
    ? picked
    : visible.reduce((best, m) => (Math.abs(+new Date(m) - +new Date(picked)) < Math.abs(+new Date(best) - +new Date(picked)) ? m : best), visible[0]);

  async function toggleMonth(m: string) {
    const next = hidden.includes(m) ? hidden.filter((x) => x !== m) : [...hidden, m];
    if (months.every((x) => next.includes(x))) return; // keep at least one
    setMonthError("");
    try {
      await onSetHiddenMonths(next);
    } catch (e) {
      setMonthError(isMissingTable(e) ? "Hiding months needs the latest database update, which hasn't been applied yet." : "Couldn't save that. Try again.");
    }
  }

  const lockMap = useMemo(() => new Map(locks.map((l) => [l.month, l])), [locks]);
  // Transactions with the app's rules applied, and locked months frozen.
  const eff = useMemo(() => applyRules(txs, rules, lockMap), [txs, rules, lockMap]);
  // Hidden months are ignored by the Inbox and its match counts.
  const inView = useMemo(() => eff.filter((t) => !hidden.includes(t.month)), [eff, hidden]);

  const allCategories = useMemo(
    () => [...new Set([...inView.map((t) => t.category), ...targets.map((t) => t.category), ...rules.map((r) => r.category)].map(canonical))].filter((c) => !RETIRED.test(c)).sort(),
    [inView, targets, rules],
  );
  const pickable = useMemo(() => allCategories.filter((c) => c !== UNCATEGORIZED), [allCategories]);
  // Shared through the database. Until something has been saved there, fall back to this device's old choices.
  const [legacy] = useState<ExcludeChoices>(loadChoices);
  const choices = savedChoices ?? legacy;
  const [choiceError, setChoiceError] = useState("");
  const excluded = useMemo(() => effectiveExcluded(allCategories, choices), [allCategories, choices]);

  async function toggle(cat: string) {
    const without = (list: string[]) => list.filter((c) => c !== cat);
    const next: ExcludeChoices = excluded.has(cat)
      ? { off: without(choices.off), on: [...without(choices.on), cat] } // turn back on
      : { off: [...without(choices.off), cat], on: without(choices.on) }; // turn off
    setChoiceError("");
    try {
      await onSaveChoices(next);
    } catch (e) {
      setChoiceError(isMissingTable(e) ? "Saving this needs the latest database update, which hasn't been applied yet." : "Couldn't save that. Try again.");
    }
  }

  const lock = lockMap.get(month);
  const live = useMemo(() => summarize(eff, targets, month, excluded), [eff, targets, month, excluded]);
  const summary = lock ? lock.snapshot.summary : live;
  const dimmed = lock ? new Set(lock.snapshot.excluded) : excluded;

  const groups = useMemo(() => uncategorizedGroups(inView, lockMap), [inView, lockMap]);

  const isCurrent = month === thisMonth;
  const isPast = month < thisMonth;
  const prevMonth = [...visible].reverse().find((m) => m < month);
  const nextMonth = visible.find((m) => m > month);
  const canPrev = prevMonth != null;
  const canNext = nextMonth != null;

  // Lock / unlock confirmation, scoped to the month it was asked for.
  const [confirm, setConfirm] = useState<{ month: string; kind: "lock" | "unlock" } | null>(null);
  const [lockError, setLockError] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const asking = confirm?.month === month ? confirm.kind : null;

  async function runLock(kind: "lock" | "unlock") {
    setLockBusy(true);
    setLockError("");
    try {
      if (kind === "lock") await onLock(month, buildSnapshot(eff, targets, month, excluded));
      else await onUnlock(month);
      setConfirm(null);
    } catch (e) {
      setLockError(
        isMissingTable(e)
          ? "The latest database update hasn't been applied yet, so locking isn't available."
          : "Couldn't save that. Check your connection and try again.",
      );
    }
    setLockBusy(false);
  }

  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("");
  const [shown, setShown] = useState(10);
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => { setDay(null); }, [month]);
  const monthTxs = useMemo(() => eff.filter((t) => t.month === month), [eff, month]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return monthTxs
      .filter((t) => (!cat || norm(canonical(t.category)) === norm(cat)) && (!q || t.name.toLowerCase().includes(q)) && (day == null || Number(t.posted_on.slice(8, 10)) === day))
      .sort((a, b) => (a.posted_on < b.posted_on ? 1 : a.posted_on > b.posted_on ? -1 : 0));
  }, [monthTxs, query, cat, day]);
  const monthCats = useMemo(() => {
    const all = new Set(monthTxs.map((t) => canonical(t.category)));
    if (cat && ![...all].some((c) => norm(c) === norm(cat))) all.add(cat); // a pinned line with no charges yet
    return [...all].sort();
  }, [monthTxs, cat]);
  // "Other" = the lines that don't count toward spending (transfers, payments, and the like).
  const otherCats = useMemo(() => new Set(monthCats.filter((c) => excluded.has(c) || excluded.has(c.toLowerCase()) || /interest|tax/i.test(c))), [monthCats, excluded]);
  const txRef = useRef<HTMLElement>(null);
  const showDay = (d: number | null) => {
    setDay(d);
    if (d == null) return;
    setQuery("");
    setCat("");
    setShown(10);
    requestAnimationFrame(() => txRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const showCategory = (category: string) => {
    setDay(null);
    setQuery("");
    setCat(category);
    setShown(10);
    requestAnimationFrame(() => txRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const tileKeys = tileCategories ?? KEY_CATEGORIES;
  const split = splitKey(summary.rows, tileKeys);
  const budget = budgetRows(summary.rows, tileKeys);
  const [tileError, setTileError] = useState("");
  async function setTiles(next: string[]) {
    setTileError("");
    try {
      await onSaveTiles(next);
    } catch (e) {
      setTileError(isMissingTable(e) ? "Saving this needs the latest database update, which hasn't been applied yet." : "Couldn't save that. Try again.");
    }
  }
  const [reordering, setReordering] = useState(false);
  // Moving a row up or down saves the new order: pinned rows reorder the tiles above too.
  const [drag, setDrag] = useState<{ group: string; from: number; over: number } | null>(null);
  const moved = <T,>(list: T[], from: number, to: number): T[] => {
    const next = [...list];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  };
  // Drag a row by its handle: find the row under the finger, show the new order live, save on release.
  function startDrag(e: React.PointerEvent<HTMLElement>, group: "g-tiles" | "g-fixed", from: number) {
    e.preventDefault();
    const list = (e.currentTarget.closest("ul") as HTMLElement).children;
    let over = from;
    setDrag({ group, from, over });
    const move = (ev: PointerEvent) => {
      for (let i = 0; i < list.length; i++) {
        const box = list[i].getBoundingClientRect();
        if (ev.clientY >= box.top && ev.clientY <= box.bottom) {
          if (i !== over) {
            over = i;
            setDrag({ group, from, over: i });
          }
          break;
        }
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setDrag(null);
      if (over !== from) void saveOrder(group, from, over);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  async function saveOrder(group: "g-tiles" | "g-fixed", from: number, to: number) {
    const rows = group === "g-tiles" ? groupsB.tiles : groupsB.fixed;
    const names = moved(rows.map((r) => r.category), from, to);
    setTileError("");
    try {
      if (group === "g-tiles") await onSaveTiles(names.map((n) => tileKeys.find((k) => norm(k) === norm(n)) ?? n));
      else await onSaveOrder(names);
    } catch (e) {
      setTileError(isMissingTable(e) ? "Saving this needs the latest database update, which hasn't been applied yet." : "Couldn't save that. Try again.");
    }
  }
  const addTile = (c: string) => setTiles([...tileKeys, c]);
  const removeTile = (c: string) => setTiles(tileKeys.filter((k) => norm(k) !== norm(c)));
  const groupsB = {
    unc: budget.rows.filter((r) => /^uncategorized$/i.test(r.category)),
    tiles: split.key,
    fixed: budget.rows
      .filter((r) => !r.featured && !/^uncategorized$/i.test(r.category))
      .map((r, i) => ({ r, i, k: budgetOrder.findIndex((n) => norm(n) === norm(r.category)) }))
      .sort((a, b) => (a.k < 0 ? Infinity : a.k) - (b.k < 0 ? Infinity : b.k) || a.i - b.i)
      .map((x) => x.r),
  };
  const [settingsOpen, setSettingsOpen] = useState(false);

  const noteAuthor = (n: Note) => {
    const set = names[n.author_id];
    if (set) return set;
    const local = (n.author_email ?? "").split("@")[0];
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Someone";
  };
  const recentCategories = [...rules].sort((a, b) => b.id - a.id).map((r) => r.category).filter((c, i, a) => a.indexOf(c) === i).slice(0, 3);

  if (inboxOpen) {
    return (
      <InboxPage
        groups={groups}
        categories={pickable}
        preview={(type, pattern, accounts, amount) => previewMatches(inView, lockMap, type, pattern, accounts, amount)}
        accountsFor={(type, pattern, amount) => accountBreakdown(inView, lockMap, type, pattern, amount)}
        onSave={onAddRule}
        onUndo={onDeleteRule}
        recent={recentCategories}
        onBack={() => setInboxOpen(false)}
      />
    );
  }

  if (settingsOpen) {
    return (
      <Settings
        myName={uid ? names[uid] ?? "" : ""}
        onSaveName={onSaveName}
        rules={rules}
        onDeleteRule={onDeleteRule}
        onUpdateRule={onUpdateRule}
        categories={allCategories}
        excluded={excluded}
        lockedExclusions={lock != null}
        months={months}
        hiddenMonths={hidden}
        onToggleMonth={toggleMonth}
        ruleAccounts={[...new Set(txs.map((t) => t.account).filter((a): a is string => !!a))].sort()}
        ruleCategories={pickable}
        preview={(type, pattern, accounts, amount) => previewMatches(inView, lockMap, type, pattern, accounts, amount)}
        onAddRule={onAddRule}
        monthError={monthError}
        choiceError={choiceError}
        targetLines={targetBreakdown(targets, month, excluded)}
        onToggle={toggle}
        onSyncNow={onSyncNow}
        month={month}
        columnMonths={[...new Set(targets.map((t) => t.effective_month))]}
        onSaveTarget={onSaveTarget}
        onBack={() => setSettingsOpen(false)}
      />
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="eyebrow">
          {isCurrent ? (
            <span>{subtitle}</span>
          ) : (
            <button className="backlink" onClick={() => setMonth(thisMonth)}>‹ Today</button>
          )}
        </div>
        <div className="titlerow">
          <label className="monthpick">
            <h1>{monthLabel(month)}<ChevronsIcon /></h1>
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Choose month">
              {[...visible].reverse().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          {(lock || isPast) && (
            <button
              className={`lockbtn ${lock ? "on" : ""}`}
              onClick={() => { setConfirm(asking ? null : { month, kind: lock ? "unlock" : "lock" }); setLockError(""); }}
              aria-expanded={!!asking}
              aria-label={lock ? "Month is locked" : "Lock this month"}
            >
              <LockIcon closed={!!lock} />
            </button>
          )}
          <div className="nav">
            <button className="icon eye" onClick={onToggleHide} aria-pressed={isHidden()} aria-label={isHidden() ? "Show amounts" : "Hide amounts"}><EyeIcon off={isHidden()} /></button>
            <button className="icon gear" onClick={() => setSettingsOpen(true)} aria-label="Settings"><GearIcon /></button>
          </div>
        </div>
      </header>

      {asking && (lock || isPast) && (
        <div className="lockpanel">
          {asking === "unlock" ? (
            <>
              <span>Locked{lock ? ` ${new Date(lock.locked_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : ""}. These numbers won't change.</span>
              <div className="row">
                <button className="danger" disabled={lockBusy} onClick={() => runLock("unlock")}>{lockBusy ? "Unlocking…" : "Unlock"}</button>
                <button className="ghost" disabled={lockBusy} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <span>Lock {monthLabel(month)}? Totals and categories freeze as they are now. You can unlock later.</span>
              <div className="row">
                <button className="primary" disabled={lockBusy} onClick={() => runLock("lock")}>{lockBusy ? "Locking…" : "Lock month"}</button>
                <button className="ghost" disabled={lockBusy} onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            </>
          )}
          {lockError && <span className="over small" role="alert">{lockError}</span>}
        </div>
      )}

      <InboxRow groups={groups} onOpen={() => setInboxOpen(true)} />

      <section className="section" aria-label="Pinned">
      {split.key.length > 0 && <>
        <div className="grouphead"><h2>Pinned</h2></div>
        <ul className="tiles">{split.key.map((r) => <KeyTile key={r.category} row={r} onOpen={showCategory} />)}</ul>
      </>}
      <div className={`tile hero ${isOffLimits(summary.spent, summary.target) ? "locked" : ""}`} aria-label="Total spending">
        <div className="tile-text">
          <div className="tile-name">{isCurrent ? "Total spent so far" : "Total spent"}</div>
          <div className="tile-amt">{isHidden() ? (summary.target > 0 ? pct(summary.spent, summary.target) : "—") : money0(summary.spent)}</div>
          <div className="tile-note">{summary.target > 0 ? (isHidden() ? "of your targets" : `of ${money0(summary.target)} in targets`) : "No targets for this month"}</div>
        </div>
        {summary.target > 0 && <Ring spent={summary.spent} target={summary.target} size={48} />}
      </div>
      </section>

      <section className="section">
        <div className="grouphead">
          <h2>Budget{!isHidden() && <span className="muted"> · {money0(budget.total)}</span>}</h2>
          {budget.rows.length > 0 && <button className="linkbtn" onClick={() => setReordering(!reordering)}>{reordering ? "Done" : "Edit"}</button>}
        </div>
        <div className="card">
        {budget.rows.length ? (
          <>
            {[
              { cls: "g-unc", label: "Uncategorized", rows: groupsB.unc },
              { cls: "g-tiles", label: "Pinned to top", rows: groupsB.tiles },
              { cls: "g-fixed", label: "Fixed costs", rows: groupsB.fixed },
            ].filter((g) => g.rows.length).map((g) => (
              <div key={g.cls} className={`bgroup ${g.cls}`}>
                {g.cls === "g-tiles" && (
                  <div className="bgroup-head">
                    <span>{g.label}</span>
                    <span>{money0(g.rows.reduce((n, r) => n + r.spent, 0))}</span>
                  </div>
                )}
                <ul className="plain">
                  {(drag && drag.group === g.cls ? moved(g.rows, drag.from, drag.over) : g.rows).map((r) => (
                    <li key={r.category} className={drag && drag.group === g.cls && g.rows[drag.from].category === r.category ? "dragging" : ""}>
                      <span className="rowname">
                        {reordering && g.cls !== "g-unc" && (
                          <span
                            className="grip"
                            role="button"
                            aria-label={`Drag to move ${r.category}`}
                            onPointerDown={(e) => startDrag(e, g.cls as "g-tiles" | "g-fixed", g.rows.findIndex((x) => x.category === r.category))}
                          >
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                              <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                            </svg>
                          </span>
                        )}
                        {r.category}
                      </span>
                      <span className="tx-amt">{isHidden() ? (r.target ? pct(r.spent, r.target) : "—") : <>{money0(r.spent)}{r.target != null && !reordering && <span className="muted"> of {money0(r.target)}</span>}</>}</span>
                      {reordering && g.cls !== "g-unc" && (
                        <button
                          className={`pinbtn ${g.cls === "g-tiles" ? "on" : ""}`}
                          aria-pressed={g.cls === "g-tiles"}
                          aria-label={g.cls === "g-tiles" ? `Unpin ${r.category}` : `Pin ${r.category} to the top`}
                          onClick={() => (g.cls === "g-tiles" ? removeTile(r.category) : addTile(r.category))}
                        >
                          <svg viewBox="0 0 24 24" width="18" height="18" fill={g.cls === "g-tiles" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
                            <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7" />
                          </svg>
                        </button>
                      )}
                      {r.target != null && r.target > 0 && (
                        <span className={`mini ${tone(r.spent, r.target)}`} role="img" aria-label={`${percentOf(r.spent, r.target)}% of budget used`}>
                          <span style={{ width: `${Math.min(r.spent / r.target, 1) * 100}%` }} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        ) : (
          <p className="muted">Nothing here yet.</p>
        )}
        {tileError && <p className="over small" role="alert">{tileError}</p>}
        </div>
      </section>

      {month <= thisMonth && summary.spent > 0 && (
        <section className="section">
          <div className="grouphead"><h2>Spending through the month</h2></div>
          <div className="card"><SpendChart summary={summary} todayDay={isCurrent ? today.getDate() : null} selected={day} onSelect={showDay} /></div>
        </section>
      )}

      <section className="section" ref={txRef}>
        <div className="grouphead"><h2>Transactions</h2><span className="muted">{filtered.length}</span></div>
        <div className="card">
        {day != null && (
          <button className="daychip" onClick={() => setDay(null)}>
            Only {dayLabel(month, day)} <span aria-hidden="true">✕</span><span className="sr">Show all days</span>
          </button>
        )}
        <div className="filters">
          <input type="search" placeholder="Search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(10); }} aria-label="Search transactions" />
          <select value={cat} onChange={(e) => { setCat(e.target.value); setShown(10); }} aria-label="Filter by category">
            <option value="">All categories</option>
            <optgroup label="Spending">
              {monthCats.filter((c) => !otherCats.has(c)).map((c) => <option key={c} value={c}>{c}</option>)}
            </optgroup>
            {monthCats.some((c) => otherCats.has(c)) && (
              <optgroup label="Other">
                {monthCats.filter((c) => otherCats.has(c)).map((c) => <option key={c} value={c}>{c}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <ul className="txs">
          {filtered.slice(0, shown).map((t) => (
            <li key={t.id} className={dimmed.has(t.category) || dimmed.has(canonical(t.category)) ? "dim" : ""}>
              <div>
                <div className="tx-name">
                  {t.name}
                  {t.pending && <span className="muted small"> · pending</span>}
                  {t.afterLock && <span className="muted small"> · arrived after lock, not counted</span>}
                </div>
                <div className="muted small">{t.posted_on.slice(5).replace("-", "/")} · {t.category}{t.account ? ` · ${t.account}` : ""}</div>
              </div>
              <div className="tx-amt">{t.amount > 0 ? "+" : ""}{money2(t.amount)}</div>
            </li>
          ))}
        </ul>
        {filtered.length > shown && (
          <button className="more" onClick={() => setShown(shown + 20)}>Show more</button>
        )}
        </div>
      </section>

      <Notes
        notes={notes.filter((n) => n.month === month)}
        nameOf={noteAuthor}
        uid={uid}
        onAdd={(body) => onAddNote(month, body)}
        onDelete={onDeleteNote}
      />
    </div>
  );
}
