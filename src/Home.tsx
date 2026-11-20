import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isDemo, supabase } from "./lib/supabase";
import { resetDemoData } from "./lib/demo/client";
import { deleteNote, insertNote, saveMyName, deleteLock, deleteRule, insertLock, insertRule, loadBudgetData, updateRule, saveBudgetOrder, saveExcludeChoices, saveHiddenMonths, saveTarget, saveTileCategories } from "./lib/data";
import type { BudgetData } from "./lib/data";
import Dashboard from "./Dashboard";
import { isHidden, setHidden } from "./lib/privacy";

/** A round arrow that appears once you've scrolled a good way down. */
function ToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 600);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!show) return null;
  return (
    <button className="totop" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
    </button>
  );
}

export default function Home({ session }: { session: Session }) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [failed, setFailed] = useState(false);

  const [, redraw] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const loadedAt = useRef(Date.now());

  useEffect(() => {
    loadBudgetData().then(setData).catch(() => setFailed(true));
  }, []);

  // Pull in the latest from the database. A failed refresh keeps what's on screen.
  const refresh = () =>
    loadBudgetData().then((d) => {
      loadedAt.current = Date.now();
      setData(d);
    });

  // An installed app can sit open in the background for hours: reload when it comes back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current > 30_000) refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function syncNow(): Promise<boolean> {
    setSyncing(true);
    setSyncMsg("");
    try {
      const { data: res, error } = await supabase.functions.invoke("sync-now");
      if (error || !res?.ok) throw new Error("sync failed");
      await refresh();
      return true;
    } catch {
      setSyncMsg("Couldn't sync. Try again in a minute.");
      return false;
    } finally {
      setSyncing(false);
    }
  }

  // Each handler writes to the database first and only then updates the screen,
  // so what's shown always matches what's saved. Errors propagate to the caller.
  const update = (fn: (d: BudgetData) => BudgetData) => setData((d) => (d ? fn(d) : d));

  return (
    <>
      {failed && (
        <main className="center">
          <h1>Sundialed</h1>
          <p className="note">Couldn't load the budget data. This account may not have access, or the latest database update hasn't been applied.</p>
        </main>
      )}
      {!failed && !data && <main className="center"><p className="muted">Loading…</p></main>}
      {data && (
        <Dashboard
          onSyncNow={syncNow}
          subtitle={
            <>
              {data.lastSync ? `Synced ${new Date(data.lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Not yet synced"}
              {data.syncStatus === "error" && " · last sync failed"}
              {" · "}
              <button className="linkbtn" onClick={syncNow} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</button>
              {syncMsg && <span className="over"> · {syncMsg}</span>}
            </>
          }
          onToggleHide={() => {
            setHidden(!isHidden());
            redraw((n) => n + 1);
          }}
          notes={data.notes}
          names={data.names}
          uid={data.uid}
          onAddNote={async (month, body) => {
            const note = await insertNote(month, body);
            update((d) => ({ ...d, notes: [...d.notes, note] }));
          }}
          onDeleteNote={async (id) => {
            await deleteNote(id);
            update((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
          }}
          onSaveName={async (name) => {
            await saveMyName(name);
            update((d) => ({ ...d, names: d.uid ? { ...d.names, [d.uid]: name } : d.names }));
          }}
          onSaveTarget={async (category, month, amount) => {
            await saveTarget(category, month, amount);
            await refresh();
          }}
          txs={data.txs}
          targets={data.targets}
          rules={data.rules}
          locks={data.locks}
          hiddenMonths={data.hiddenMonths}
          savedChoices={data.excludeChoices}
          tileCategories={data.tileCategories}
          budgetOrder={data.budgetOrder}
          onSaveOrder={async (names) => {
            await saveBudgetOrder(names);
            update((d) => ({ ...d, budgetOrder: names }));
          }}
          onSaveTiles={async (categories) => {
            await saveTileCategories(categories);
            update((d) => ({ ...d, tileCategories: categories }));
          }}
          onSaveChoices={async (choices) => {
            await saveExcludeChoices(choices);
            update((d) => ({ ...d, excludeChoices: choices }));
          }}
          onSetHiddenMonths={async (months) => {
            await saveHiddenMonths(months);
            update((d) => ({ ...d, hiddenMonths: months }));
          }}
          onAddRule={async (type, pattern, category, accounts, amount) => {
            const rule = await insertRule(type, pattern, category, accounts, amount);
            update((d) => ({ ...d, rules: [...d.rules, rule] }));
            return rule.id;
          }}
          onUpdateRule={async (id, type, pattern, category, accounts, amount) => {
            const rule = await updateRule(id, type, pattern, category, accounts, amount);
            update((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? rule : r)) }));
          }}
          onDeleteRule={async (id) => {
            await deleteRule(id);
            update((d) => ({ ...d, rules: d.rules.filter((r) => r.id !== id) }));
          }}
          onLock={async (month, snapshot) => {
            const lock = await insertLock(month, snapshot);
            update((d) => ({ ...d, locks: [...d.locks, lock] }));
          }}
          onUnlock={async (month) => {
            await deleteLock(month);
            update((d) => ({ ...d, locks: d.locks.filter((l) => l.month !== month) }));
          }}
        />
      )}
      <footer className="foot">
        <span>
          {session.user.email} ·{" "}
          <button className="linkbtn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          {isDemo && (
            <>
              {" · "}
              <button className="linkbtn" onClick={() => { if (confirm("Reset to the original sample data?")) { resetDemoData(); location.reload(); } }}>Reset demo data</button>
            </>
          )}
        </span>
      </footer>
      <p className="love">{isDemo ? "Demo with fictional data, saved in this browser only" : `© ${new Date().getFullYear()} Sundialed`}</p>
      <ToTop />
    </>
  );
}
