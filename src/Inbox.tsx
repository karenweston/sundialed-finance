import type React from "react";
import { useEffect, useState } from "react";
import { money0, money2 } from "./lib/privacy";
import { normalizePattern, parseAmount, ruleErrorText } from "./lib/rules";
import type { Group, MatchType, Rule } from "./lib/rules";

interface InboxProps {
  groups: Group[];
  categories: string[];
  preview: (type: MatchType, pattern: string, accounts: string[], amount: number | null) => number;
  accountsFor: (type: MatchType, pattern: string, amount: number | null) => { account: string; count: number }[];
  onSave: (type: MatchType, pattern: string, category: string, accounts: string[], amount: number | null) => Promise<number>;
  onUndo: (id: number) => Promise<void>;
  /** Categories used by the most recent rules, newest first. */
  recent: string[];
}

const isAmazon = (name: string) => /amazon/i.test(name);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const CheckIcon = () => (
  <svg className="chk" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const Chev = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
);
const XIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
);

interface Saved { id: number; text: string }

/** Tap a category to save a rule for this merchant right away; "More options" covers the rare cases. */
function CategorySheet({ group, categories, recent, preview, accountsFor, onSave, onClose, onSaved }: InboxProps & { group: Group; onClose: () => void; onSaved: (s: Saved) => void }) {
  const amazon = isAmazon(group.name);
  const [view, setView] = useState<"list" | "more">("list");
  const [picking, setPicking] = useState(false); // choosing a category from inside More options
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [scope, setScope] = useState<MatchType>(amazon ? "contains" : "exact");
  const [pattern, setPattern] = useState(amazon ? "amazon" : normalizePattern(group.name));
  const [accounts, setAccounts] = useState<string[]>([]);
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const amount = parseAmount(amountText);
  const badAmount = Number.isNaN(amount);
  const exactAmount = badAmount ? null : amount;
  const effectivePattern = scope === "exact" ? normalizePattern(group.name) : normalizePattern(pattern);
  const tooShort = scope === "contains" && effectivePattern.length < 3;
  const available = accountsFor(scope, effectivePattern, exactAmount);
  const picked = accounts.filter((a) => available.some((x) => x.account === a));
  const matches = preview(scope, effectivePattern, picked, exactAmount);
  const label = amazon ? "Amazon" : group.name;
  const canSave = !tooShort && !badAmount && matches > 0 && !busy;

  async function commit(cat: string) {
    const name = cat.trim();
    if (!name || name.length > 60 || !canSave) return;
    setBusy(true);
    setError("");
    try {
      const id = await onSave(scope, effectivePattern, name, picked, exactAmount);
      onSaved({ id, text: `${group.name} → ${name} · ${plural(matches, "transaction")}` });
    } catch (e) {
      setError(ruleErrorText(e));
      setBusy(false);
    }
  }

  function choose(cat: string) {
    if (picking) { setCategory(cat.trim()); setPicking(false); setAdding(false); setView("more"); }
    else commit(cat);
  }

  const catRows = (list: string[]) => (
    <section className="card setlist">
      {list.map((c) => (
        <button key={c} className="setrow" disabled={busy} onClick={() => choose(c)}>
          <span className="setlabel">{c}</span>
          {picking && category === c && <CheckIcon />}
        </button>
      ))}
    </section>
  );
  const shownRecent = recent.filter((c) => categories.includes(c)).slice(0, 3);

  let head: React.ReactNode;
  let body: React.ReactNode;
  if (view === "list") {
    head = (
      <div className="sheetnav">
        <button className="circbtn" aria-label="Close" onClick={onClose}><XIcon /></button>
        <div className="sheettitle"><b>{picking ? "Category" : group.name}</b><span>{plural(group.count, "charge")} · {money0(group.spent)}</span></div>
        <span />
      </div>
    );
    body = (
      <>
        <p className="caption">
          {picking
            ? "Choose a category for this rule."
            : `Tap a category to save a rule for every “${label}” charge, on any account. It catches ${plural(matches, "transaction")} with no category now.`}
        </p>
        {shownRecent.length > 0 && (<><h2 className="setgroup-title">Recent</h2>{catRows(shownRecent)}</>)}
        <h2 className="setgroup-title">All categories</h2>
        {catRows(categories)}
        <section className="card setlist">
          {adding ? (
            <div className="setrow static">
              <input className="rowinput" autoFocus placeholder="New category name" value={newCat} maxLength={60} onChange={(e) => setNewCat(e.target.value)} aria-label="New category name" />
              <button className="ghost" disabled={busy || !newCat.trim()} onClick={() => choose(newCat)}>{picking ? "Use" : "Save"}</button>
            </div>
          ) : (
            <button className="setrow" onClick={() => setAdding(true)}><span className="setlabel">New category…</span></button>
          )}
        </section>
        {!picking && (
          <section className="card setlist">
            <button className="setrow" onClick={() => setView("more")}>
              <span className="setlabel">More options</span><span className="setchev"><Chev /></span>
            </button>
          </section>
        )}
      </>
    );
  } else {
    const ready = category.length > 0 && canSave;
    head = (
      <div className="sheetnav">
        <button className="circbtn" aria-label="Back" onClick={() => setView("list")}><BackIcon /></button>
        <div className="sheettitle"><b>More options</b><span>{group.name}</span></div>
        <button className="circbtn solid" aria-label="Save rule" disabled={!ready} onClick={() => commit(category)}><CheckIcon /></button>
      </div>
    );
    body = (
      <>
        <section className="card setlist">
          <button className="setrow" onClick={() => { setPicking(true); setView("list"); }}>
            <span className="setlabel">Category</span>
            <span className="setvalue">{category || "Choose…"}</span>
            <span className="setchev"><Chev /></span>
          </button>
        </section>
        <h2 className="setgroup-title">Apply to</h2>
        <section className="card setlist">
          <button className="setrow" role="radio" aria-checked={scope === "exact"} onClick={() => setScope("exact")}>
            <span className="setlabel">Just “{group.name}”</span>{scope === "exact" && <CheckIcon />}
          </button>
          <button className="setrow" role="radio" aria-checked={scope === "contains"} onClick={() => setScope("contains")}>
            <span className="setlabel">Anything containing…</span>{scope === "contains" && <CheckIcon />}
          </button>
          {scope === "contains" && (
            <div className="setrow static">
              <input className="rowinput left" value={pattern} maxLength={120} onChange={(e) => setPattern(e.target.value)} aria-label="Text to match" />
            </div>
          )}
        </section>
        {scope === "contains" && amazon && <p className="caption">Covers every Amazon variant, whatever the bank calls it.</p>}
        {tooShort && <p className="over small caption">Use at least 3 characters.</p>}
        {available.length > 0 && (
          <>
            <h2 className="setgroup-title">Paid with</h2>
            <section className="card setlist">
              {available.map((a) => (
                <button key={a.account} className="setrow" role="checkbox" aria-checked={accounts.includes(a.account)}
                  onClick={() => setAccounts((cur) => (cur.includes(a.account) ? cur.filter((x) => x !== a.account) : [...cur, a.account]))}>
                  <span className="setlabel">{a.account} <span className="muted small">· {a.count}</span></span>
                  {accounts.includes(a.account) && <CheckIcon />}
                </button>
              ))}
            </section>
            <p className="caption">{picked.length ? "Only these accounts." : "Leave all unchecked to apply to every account."}</p>
          </>
        )}
        <section className="card setlist">
          <label className="setrow">
            <span className="setlabel">Exact amount</span>
            <input className="rowinput" inputMode="decimal" placeholder="Any amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-label="Exact amount" />
          </label>
        </section>
        {group.amounts.length === 1 && amountText === "" && (
          <button className="linkbtn left" type="button" onClick={() => setAmountText(String(group.amounts[0]))}>
            Every one of these is {money2(group.amounts[0])}. Use that amount.
          </button>
        )}
        {badAmount && <p className="over small caption">Enter an amount like 500 or 1,250.50.</p>}
        <p className="caption">
          Catches {plural(matches, "transaction")} that have no category now. This fills gaps only; anything your Sheet already categorizes stays as is.
        </p>
      </>
    );
  }

  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Categorize ${group.name}`} onClick={(e) => e.stopPropagation()}>
        {head}
        {error && <p className="over small caption" role="alert">{error}</p>}
        {body}
      </div>
    </div>
  );
}

const sumGroups = (groups: Group[]) => ({
  total: groups.reduce((n, g) => n + g.spent, 0),
  count: groups.reduce((n, g) => n + g.count, 0),
});

/** The compact Inbox on the home screen: one tappable row that opens the full list. */
export function InboxRow({ groups, onOpen }: { groups: Group[]; onOpen: () => void }) {
  if (!groups.length) return null;
  const { total, count } = sumGroups(groups);
  return (
    <button className="card inboxrow" onClick={onOpen}>
      <span className="badge big">{groups.length}</span>
      <span className="inboxrow-text">
        <span className="inboxrow-title">Inbox</span>
        <span className="muted small">{groups.length === 1 ? "1 merchant" : `${groups.length} merchants`} · {count} transactions · {money0(total)}</span>
      </span>
      <span className="setchev" aria-hidden="true">›</span>
    </button>
  );
}

/** The full Inbox, on its own page. */
export function InboxPage(props: InboxProps & { onBack: () => void }) {
  const { groups, onBack, onUndo } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [toast, setToast] = useState<Saved | null>(null);
  const [undoError, setUndoError] = useState("");
  const { total, count } = sumGroups(groups);
  const visible = all ? groups : groups.slice(0, 12);
  const openGroup = groups.find((g) => g.key === open) ?? null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  async function undo() {
    if (!toast) return;
    try { await onUndo(toast.id); setToast(null); setUndoError(""); }
    catch { setUndoError("Couldn't undo that. Remove it from Settings, Your rules."); }
  }

  return (
    <div className="page">
      <header className="navbar">
        <button className="circbtn" aria-label="Back" onClick={onBack}><BackIcon /></button>
        <h1>Inbox</h1>
        <span />
      </header>
      {groups.length === 0 ? (
        <section className="card"><p className="muted">All caught up. Nothing needs a category.</p></section>
      ) : (
        <div className="subpage">
          <p className="caption">
            Merchants with no category yet. {count} transactions, {money0(total)} net, across months that aren't locked or hidden.
          </p>
          <section className="card setlist">
            {visible.map((g) => (
              <div key={g.key} className="irow">
                <div className="irow-text">
                  <div className="tx-name">{g.name}</div>
                  <div className="muted small">
                    {g.count} × · last {g.last.slice(5).replace("-", "/")}
                    {g.bank && <> · {g.bank.toLowerCase().replace(/_/g, " ")}</>}
                  </div>
                </div>
                <div className="group-side">
                  <span className="tx-amt">{money0(g.spent)}</span>
                  <button className="ghost" onClick={() => setOpen(g.key)}>Categorize</button>
                </div>
              </div>
            ))}
          </section>
          {groups.length > 12 && (
            <button className="more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${groups.length}`}</button>
          )}
        </div>
      )}
      {openGroup && (
        <CategorySheet
          {...props}
          group={openGroup}
          onClose={() => setOpen(null)}
          onSaved={(s) => { setOpen(null); setToast(s); setUndoError(""); }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{undoError || toast.text}</span>
          {!undoError && <button onClick={undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

export function Mappings({ rules, onDelete, open, renderEditor }: { rules: Rule[]; onDelete: (id: number) => Promise<void>; open?: boolean; renderEditor?: (rule: Rule, close: () => void) => React.ReactNode }) {
  const [armed, setArmed] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function remove(id: number) {
    if (armed !== id) { setArmed(id); setError(""); return; }
    try { await onDelete(id); setArmed(null); } catch { setError("Couldn't remove that. Try again."); }
  }

  const being = renderEditor ? rules.find((r) => r.id === editing) : undefined;
  if (being && renderEditor) return <>{renderEditor(being, () => setEditing(null))}</>;

  return (
    <>
      {rules.length === 0 ? (
        <section className="card"><p className="muted">None yet. Rules you save from the Inbox appear here.</p></section>
      ) : (
        <section className="card setlist">
          {rules.map((r) => (
            <div key={r.id} className="irow">
              <div className="irow-text">
                <div className="tx-name">
                  {r.match_type === "exact" ? "" : "contains "}“{r.pattern}” → {r.category}
                </div>
                {(r.accounts.length > 0 || r.amount != null) && (
                  <div className="muted small">
                    {[r.accounts.length > 0 ? `only ${r.accounts.join(" + ")}` : "", r.amount != null ? `only ${money2(r.amount)}` : ""].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div className="rule-actions">
                {renderEditor && armed !== r.id && <button className="ghost" onClick={() => { setEditing(r.id); setArmed(null); }}>Edit</button>}
                <button className={armed === r.id ? "danger" : "ghost"} onClick={() => remove(r.id)}>
                  {armed === r.id ? "Tap again to remove" : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {error && <p className="over small caption" role="alert">{error}</p>}
      <p className="caption">Removing a rule makes those transactions uncategorized again, except in locked months.</p>
    </>
  );
}
