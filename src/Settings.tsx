import { useState } from "react";
import type React from "react";
import { Mappings } from "./Inbox";
import AddRule from "./AddRule";
import Notifications from "./Notifications";
import ImportApple from "./ImportApple";
import Targets from "./Targets";
import type { MatchType } from "./lib/rules";
import { CARD_DEFAULTS } from "./lib/rules";
import type { Rule } from "./lib/rules";
import { monthLabel } from "./lib/budget";
import { money0 } from "./lib/privacy";
import type { TargetLine } from "./lib/budget";

const Check = () => (
  <svg className="chk" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const Chev = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
);

interface Props {
  myName: string;
  onSaveName: (name: string) => Promise<void>;
  rules: Rule[];
  onDeleteRule: (id: number) => Promise<void>;
  onUpdateRule: (id: number, type: MatchType, pattern: string, category: string, accounts: string[], amount: number | null) => Promise<void>;
  categories: string[];
  excluded: Set<string>;
  lockedExclusions: boolean;
  month: string;
  columnMonths: string[];
  onSaveTarget: (category: string, month: string, amount: number | null) => Promise<void>;
  months: string[];
  hiddenMonths: string[];
  onToggleMonth: (month: string) => void;
  ruleAccounts: string[];
  ruleCategories: string[];
  preview: (type: MatchType, pattern: string, accounts: string[], amount: number | null) => number;
  onAddRule: (type: MatchType, pattern: string, category: string, accounts: string[], amount: number | null) => Promise<number>;
  monthError: string;
  choiceError: string;
  targetLines: { lines: TargetLine[]; total: number };
  onToggle: (category: string) => void;
  onSyncNow?: () => Promise<boolean>;
  onBack: () => void;
}

export default function Settings({ myName, onSaveName, rules, onDeleteRule, onUpdateRule, categories, excluded, lockedExclusions, month, columnMonths, onSaveTarget, months, hiddenMonths, onToggleMonth, ruleAccounts, ruleCategories, preview, onAddRule, monthError, choiceError, targetLines, onToggle, onSyncNow, onBack }: Props) {
  type Page = "root" | "rules" | "yours" | "add" | "spending" | "targets" | "months" | "notifications" | "apple" | "name";
  const [page, setPage] = useState<Page>("root");
  const [nameText, setNameText] = useState(myName);
  const [nameMsg, setNameMsg] = useState("");
  const [nameBusy, setNameBusy] = useState(false);

  const titles: Record<Page, string> = {
    root: "Settings",
    rules: "Built-in rules",
    yours: "Your rules",
    add: "Add a rule",
    spending: "Counts toward spending",
    targets: "Targets in use",
    months: "Months",
    notifications: "Notifications",
    apple: "Import Apple Card",
    name: "Your name",
  };
  const countedN = categories.filter((c) => !excluded.has(c)).length;
  const hiddenN = hiddenMonths.length;

  const Row = ({ to, label, value }: { to: Page; label: string; value?: string }) => (
    <button className="setrow" onClick={() => setPage(to)}>
      <span className="setlabel">{label}</span>
      {value && <span className="setvalue">{value}</span>}
      <span className="setchev" aria-hidden="true"><Chev /></span>
    </button>
  );

  return (
    <div className="page">
      <header className="navbar">
        <button className="circbtn" aria-label={page === "root" ? "Close settings" : "Back to Settings"} onClick={page === "root" ? onBack : () => setPage("root")}>
          {page === "root" ? (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          )}
        </button>
        <h1>{titles[page]}</h1>
        <span />
      </header>

      {page === "root" && (
        <>
          <h2 className="setgroup-title">Categorizing</h2>
          <div className="card setlist">
            <Row to="rules" label="Built-in rules" />
            <Row to="yours" label="Your rules" value={String(rules.length)} />
            <Row to="add" label="Add a rule" />
          </div>

          <h2 className="setgroup-title">Your budget</h2>
          <div className="card setlist">
            <Row to="spending" label="Counts toward spending" value={`${countedN} of ${categories.length}`} />
            <Row to="targets" label="Targets in use" value={money0(targetLines.total)} />
            <Row to="months" label="Months" value={hiddenN ? `${hiddenN} hidden` : "All shown"} />
          </div>

          <h2 className="setgroup-title">Data</h2>
          <div className="card setlist">
            <Row to="apple" label="Import Apple Card" />
          </div>

          <h2 className="setgroup-title">You</h2>
          <div className="card setlist">
            <Row to="name" label="Your name" value={myName || "Not set"} />
          </div>

          <h2 className="setgroup-title">This phone</h2>
          <div className="card setlist">
            <Row to="notifications" label="Notifications" />
          </div>
        </>
      )}

      <div className="subpage">
      {page === "name" && (
        <>
          <p className="caption">Shown next to the notes you add. Just your first name is fine.</p>
          <section className="card setlist">
            <label className="setrow">
              <input className="rowinput left" value={nameText} maxLength={40} placeholder="Your name" onChange={(e) => { setNameText(e.target.value); setNameMsg(""); }} aria-label="Your name" />
            </label>
          </section>
          <button className="primary fullbtn" disabled={nameBusy || !nameText.trim() || nameText.trim() === myName} onClick={async () => {
            setNameBusy(true);
            try { await onSaveName(nameText.trim()); setNameMsg("Saved."); } catch { setNameMsg("Couldn't save that. Try again."); }
            setNameBusy(false);
          }}>{nameBusy ? "Saving…" : "Save"}</button>
          {nameMsg && <p className={nameMsg === "Saved." ? "saved small" : "over small"} role="status">{nameMsg}</p>}
        </>
      )}

      {page === "rules" && (
        <>
          <p className="caption">Every transaction gets its category from the first of these that has an answer, top to bottom.</p>
          <ol className="stepcards">
            <li className="card stepcard">
              <span className="stepnum" aria-hidden="true">1</span>
              <div><h3>Your month tab in the Sheet</h3>
              <p>The category you typed on that row in the month's tab (October2026, for example). It always wins.</p></div>
            </li>
            <li className="card stepcard">
              <span className="stepnum" aria-hidden="true">2</span>
              <div><h3>Transfers and card payments</h3>
              <p>Only for rows the Vendor Mapping doesn't know. If the bank labels a row a transfer or card payment and the same amount, going the other way, shows up in another account on your Sheet within 5 days, both are ignored. Anything unmatched goes to the Inbox.</p></div>
            </li>
            <li className="card stepcard">
              <span className="stepnum" aria-hidden="true">3</span>
              <div><h3>The Sheet's Vendor Mapping</h3>
              <p>The category listed for that merchant.</p></div>
            </li>
            <li className="card stepcard">
              <span className="stepnum" aria-hidden="true">4</span>
              <div><h3>Your rules in the app</h3>
              <p>Only for what's still uncategorized. If several fit, the most specific wins: exact amount, then a specific account, then an exact match, then the longest text.</p></div>
            </li>
            <li className="card stepcard">
              <span className="stepnum" aria-hidden="true">5</span>
              <div><h3>Card rules</h3>
              <p>Last, for charges still uncategorized. Refunds and payments are left alone.</p>
              <ul className="cardrules">
                {CARD_DEFAULTS.map((d) => (
                  <li key={d.accountLabel}>{d.accountLabel} → {d.category}</li>
                ))}
              </ul></div>
            </li>
          </ol>
          <p className="caption">Locked months skip all of this and keep the categories they had when locked. Anything still uncategorized lands in the Inbox.</p>
        </>
      )}

      {page === "yours" && <Mappings
          rules={rules}
          onDelete={onDeleteRule}
          open
          renderEditor={(r, close) => (
            <AddRule
              rule={r}
              accounts={ruleAccounts}
              categories={ruleCategories.includes(r.category) ? ruleCategories : [...ruleCategories, r.category].sort()}
              preview={preview}
              onSave={(type, pattern, category, accts, amount) => onUpdateRule(r.id, type, pattern, category, accts, amount)}
              onCancel={close}
            />
          )}
        />}

      {page === "add" && <AddRule accounts={ruleAccounts} categories={ruleCategories} preview={preview} onSave={onAddRule} />}

      {page === "notifications" && <Notifications />}
      {page === "apple" && <ImportApple onSyncNow={onSyncNow} />}

      {page === "months" && (
        <>
        <p className="caption">
          A checked month shows when you move between months. Unchecked months are skipped, not deleted, and you can bring
          one back any time. Shared by everyone with access.
        </p>
        <section className="card setlist">
          {[...months].reverse().map((m) => (
            <button key={m} className="setrow" role="checkbox" aria-checked={!hiddenMonths.includes(m)} onClick={() => onToggleMonth(m)}>
              <span className="setlabel">{monthLabel(m)}</span>
              {!hiddenMonths.includes(m) && <Check />}
            </button>
          ))}
        </section>
        {monthError && <p className="over small caption" role="alert">{monthError}</p>}
        </>
      )}

      {page === "targets" && <Targets month={month} columnMonths={columnMonths} lines={targetLines.lines} total={targetLines.total} locked={lockedExclusions} onSave={onSaveTarget} />}

      {page === "spending" && (
        <>
        <p className="caption">
          A checkmark means the category counts toward your spending totals, the progress rings and the chart. Uncheck money that
          only moves around, like card payments, transfers and income; it still shows in your transaction list, dimmed.
          Shared by everyone with access.{lockedExclusions && " Locked months keep the choices they were locked with."}
        </p>
        <section className="card setlist">
          {categories.map((c) => (
            <button key={c} className="setrow" role="checkbox" aria-checked={!excluded.has(c)} onClick={() => onToggle(c)}>
              <span className="setlabel">{c}</span>
              {!excluded.has(c) && <Check />}
            </button>
          ))}
        </section>
        {choiceError && <p className="over small caption" role="alert">{choiceError}</p>}
        </>
      )}
      </div>
    </div>
  );
}
