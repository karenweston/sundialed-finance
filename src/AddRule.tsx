import { useState } from "react";
import type React from "react";
import { money2 } from "./lib/privacy";
import { normalizePattern, parseAmount, ruleErrorText } from "./lib/rules";
import type { MatchType } from "./lib/rules";
import type { Rule } from "./lib/rules";

interface Props {
  accounts: string[];
  categories: string[];
  preview: (type: MatchType, pattern: string, accounts: string[], amount: number | null) => number;
  onSave: (type: MatchType, pattern: string, category: string, accounts: string[], amount: number | null) => Promise<unknown>;
  /** Edit an existing rule: the form opens pre-filled and replaces the intro and the "New rule" button. */
  rule?: Rule;
  onCancel?: () => void;
}

const NEW = "__new__";

export default function AddRule({ accounts, categories, preview, onSave, rule, onCancel }: Props) {
  const editing = !!rule;
  
  const [scope, setScope] = useState<MatchType>(rule?.match_type ?? "contains");
  const [text, setText] = useState(rule?.pattern ?? "");
  const [picked, setPicked] = useState<string[]>(rule?.accounts ?? []);
  const [amountText, setAmountText] = useState(rule?.amount != null ? String(rule.amount) : "");
  const [category, setCategory] = useState(rule?.category ?? "");
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const pattern = normalizePattern(text);
  const amount = parseAmount(amountText);
  const badAmount = Number.isNaN(amount);
  const exact = badAmount ? null : amount;
  const chosen = category === NEW ? newCat.trim() : category;
  const minLen = scope === "contains" ? 3 : 2;
  const tooShort = pattern.length < minLen;
  const matches = tooShort || editing ? 0 : preview(scope, pattern, picked, exact);
  const ready = !tooShort && !badAmount && chosen.length > 0 && chosen.length <= 60 && !busy;

  async function save() {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await onSave(scope, pattern, chosen, picked, exact);
      if (editing) { onCancel?.(); return; }
      setSaved(`Saved: “${pattern}”${picked.length ? ` on ${picked.join(" + ")}` : ""}${exact != null ? ` · ${money2(exact)}` : ""} → ${chosen}.`);
      setText(""); setPicked([]); setAmountText(""); setCategory(""); setNewCat("");
    } catch (e) {
      setError(ruleErrorText(e));
    }
    setBusy(false);
  }

  const chk = <svg className="chk" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

  const form = (
    <>
      {saved && <p className="saved small" role="status">{saved}</p>}
      <h2 className="setgroup-title">When the description</h2>
      <section className="card setlist">
        <button className="setrow" role="radio" aria-checked={scope === "contains"} onClick={() => setScope("contains")}>
          <span className="setlabel">Contains</span>{scope === "contains" && chk}
        </button>
        <button className="setrow" role="radio" aria-checked={scope === "exact"} onClick={() => setScope("exact")}>
          <span className="setlabel">Is exactly</span>{scope === "exact" && chk}
        </button>
        <label className="setrow">
          <input className="rowinput left" value={text} maxLength={120} placeholder={scope === "contains" ? "e.g. online transfer" : "Exact name"} onChange={(e) => setText(e.target.value)} aria-label="Text to match" />
        </label>
      </section>
      {text !== "" && tooShort && <p className="over small caption">Use at least {minLen} characters.</p>}

      {accounts.length > 0 && (
        <>
          <h2 className="setgroup-title">Paid with</h2>
          <section className="card setlist">
            {accounts.map((a) => (
              <button key={a} className="setrow" role="checkbox" aria-checked={picked.includes(a)} onClick={() => setPicked((c) => (c.includes(a) ? c.filter((x) => x !== a) : [...c, a]))}>
                <span className="setlabel">{a}</span>{picked.includes(a) && chk}
              </button>
            ))}
          </section>
          <p className="caption">{picked.length ? "Only these accounts." : "Leave all unchecked to apply to every account."}</p>
        </>
      )}

      <h2 className="setgroup-title">Then</h2>
      <section className="card setlist">
        <label className="setrow">
          <span className="setlabel">Exact amount</span>
          <input className="rowinput" inputMode="decimal" placeholder="Any amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-label="Exact amount" />
        </label>
        <label className="setrow">
          <span className="setlabel">Category</span>
          <select className="rowselect" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={NEW}>New category…</option>
          </select>
        </label>
        {category === NEW && (
          <label className="setrow">
            <input className="rowinput left" placeholder="New category name" value={newCat} maxLength={60} onChange={(e) => setNewCat(e.target.value)} aria-label="New category name" />
          </label>
        )}
      </section>
      {badAmount && <p className="over small caption">Enter an amount like 500 or 1,250.50.</p>}
      {!tooShort && !editing && (
        <p className="caption">
          {matches === 1 ? "Catches 1 transaction" : `Catches ${matches} transactions`} with no category now, and will
          apply to future ones too.
        </p>
      )}
      {error && <p className="over small caption" role="alert">{error}</p>}
      <button className="primary fullbtn" disabled={!ready} onClick={save}>{busy ? "Saving…" : editing ? "Save changes" : "Save rule"}</button>
      {editing && <button className="linkbtn cancelbtn" onClick={() => onCancel?.()} disabled={busy}>Cancel</button>}
    </>
  );

  return editing ? (
    <div className="editrule">{form}</div>
  ) : (
    <>
      <p className="caption">
        For things that repeat, like a monthly transfer between two accounts. Add an amount to catch only that exact
        size; other transfers stay separate for their own rules. Rules only fill transactions the Sheet left uncategorized.
      </p>
      {form}
    </>
  );
}
