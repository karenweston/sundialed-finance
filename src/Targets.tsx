import { useState } from "react";
import { monthLabel } from "./lib/budget";
import { money0 } from "./lib/privacy";
import type { TargetLine } from "./lib/budget";
import { parseAmount } from "./lib/rules";

interface Props {
  month: string;
  columnMonths: string[]; // months that have a column in the Sheet's Targets tab
  lines: TargetLine[];
  total: number;
  locked: boolean;
  onSave: (category: string, month: string, amount: number | null) => Promise<void>;
}

/** "Targets in use": what the total adds up, and a way to change a line, which writes to the Sheet. */
export default function Targets({ month, columnMonths, lines, total, locked, onSave }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const name = monthLabel(month).replace(/ \d{4}$/, "");
  const own = columnMonths.includes(month);
  const newest = columnMonths.reduce((a, m) => (m > a ? m : a), "");
  const canEdit = !locked && (own || month > newest);

  async function save(line: TargetLine, amount: number | null) {
    setBusy(true);
    setError("");
    setDone("");
    try {
      await onSave(line.raws[0], month, amount);
      setOpen(null);
      setDone(`Saved to your Sheet: ${line.category} ${amount == null ? "has no target" : `is ${money0(amount)}`} from ${name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the Sheet.");
    }
    setBusy(false);
  }

  const typed = parseAmount(text);
  return (
    <>
    <div className="caption">
      {canEdit ? (
        <p>
          <b>Tap a line to change its target.</b> {own ? `This changes the ${name} column in your Targets tab.` : `This starts a ${name} column in your Targets tab, copied from your latest one.`}
        </p>
      ) : locked ? (
        <p><b>Targets can’t be changed for a locked month.</b> It keeps the total it had when locked.</p>
      ) : (
        <p><b>Targets can’t be changed for {name} yet.</b> Add a {name} column in the Sheet first. The app can only change the newest column, or start the next one.</p>
      )}
      <p>
        {monthLabel(month)}. What the “in targets” total adds up, from your Targets tab (each month uses the latest month column on that tab; a blank cell means no target).
        Bills and Subscription count as one. Gray lines are left out of the total.
      </p>
    </div>
    <section className="card setlist">
      {lines.map((l) => {
        const editable = canEdit && l.raws.length === 1;
        const isOpen = open === l.category;
        const label = <span className="setlabel">{l.category}{!l.counted && <span className="muted small"> · not counted</span>}</span>;
        return (
          <div key={l.category} className={`tline ${l.counted ? "" : "dim"}`}>
            {editable ? (
              <button className="setrow" onClick={() => { setOpen(isOpen ? null : l.category); setText(String(l.amount)); setError(""); setDone(""); }} aria-expanded={isOpen}>
                {label}
                <span className="setvalue edit">{money0(l.amount)}</span>
                <span className={`setchev ${isOpen ? "open" : ""}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
                </span>
              </button>
            ) : (
              <div className="setrow static">
                {label}
                <span className="setvalue">{money0(l.amount)}</span>
              </div>
            )}
            {isOpen && (
              <div className="tedit">
                <label className="tedit-field">
                  <span>{l.category} target from {name}</span>
                  <input inputMode="decimal" value={text} autoFocus onChange={(e) => setText(e.target.value)} aria-label={`${l.category} target`} />
                </label>
                {Number.isNaN(typed) && <p className="over small">Enter an amount like 500 or 1,250.50.</p>}
                <div className="row">
                  <button className="primary" disabled={busy || typed == null || Number.isNaN(typed)} onClick={() => save(l, typed)}>{busy ? "Saving…" : "Save to Sheet"}</button>
                  <button className="ghost" disabled={busy} onClick={() => save(l, null)}>No target</button>
                  <button className="ghost" disabled={busy} onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="setrow static total"><span className="setlabel">Total in targets</span><span className="setvalue">{money0(total)}</span></div>
    </section>
    {error && <p className="over small caption" role="alert">{error}</p>}
    {done && <p className="saved small" role="status">{done}</p>}
    {canEdit && lines.some((l) => l.raws.length > 1) && <p className="caption">Lines made from two rows in the Sheet (like Bills and Subscription) can only be changed there.</p>}
    </>
  );
}
