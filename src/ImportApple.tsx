import { useEffect, useRef, useState } from "react";
import { loadAppleState, saveAppleImport, undoAppleImport } from "./lib/data";
import type { AppleState } from "./lib/data";
import { isMissingTable } from "./lib/rules";
import { MAX_CSV_BYTES, parseAppleCsv, previewImport } from "./lib/applecard";
import type { CsvPreview } from "./lib/applecard";
import { money2 } from "./lib/privacy";

export default function ImportApple({ onSyncNow }: { onSyncNow?: () => Promise<boolean> }) {
  const [state, setState] = useState<AppleState | null>(null);
  const [preview, setPreview] = useState<(CsvPreview & { skipped: number; name: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = () =>
    loadAppleState()
      .then(setState)
      .catch((e) =>
        setError(isMissingTable(e) ? "Importing needs the latest database update, which hasn't been applied yet." : "Couldn't load the Apple Card status."),
      );
  useEffect(() => {
    load();
  }, []);

  async function pick(file: File | undefined) {
    setError("");
    setDone("");
    setPreview(null);
    if (!file || !state) return;
    if (file.size > MAX_CSV_BYTES) return setError("That file is too large to be an Apple Card export.");
    setBusy(true);
    try {
      const { lines, skipped } = parseAppleCsv(await file.text());
      if (!lines.length) throw new Error("No transactions found in that file.");
      setPreview({ ...(await previewImport(lines, state.known)), skipped, name: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.");
    }
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  async function add() {
    if (!preview || !preview.fresh.length) return;
    setBusy(true);
    setError("");
    try {
      await saveAppleImport(preview.fresh);
      const n = preview.fresh.length;
      setPreview(null);
      const synced = onSyncNow ? await onSyncNow() : false;
      setDone(
        synced
          ? `Added ${n} transaction${n === 1 ? "" : "s"}. They're in your budget now and are being added to the Sheet.`
          : `Added ${n} transaction${n === 1 ? "" : "s"}. They'll show up and be added to the Sheet at the next sync.`,
      );
      await load();
    } catch (e) {
      setError(isMissingTable(e) ? "Importing needs the latest database update, which hasn't been applied yet." : "Couldn't save the import. Nothing was added; try again.");
    }
    setBusy(false);
  }

  async function undo() {
    setBusy(true);
    setError("");
    try {
      await undoAppleImport();
      setDone("Took back the imports that were waiting. Run Sync now to refresh the budget.");
      await load();
    } catch {
      setError("Couldn't take those back. Try again.");
    }
    setBusy(false);
  }

  const dates = preview ? preview.fresh.map((r) => r.posted_on).sort() : [];
  const range = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "";
  const net = preview ? preview.fresh.reduce((n, r) => n + r.amount, 0) : 0;

  return (
    <>
    <p className="caption">
      In the Wallet app, open Apple Card, tap Card Balance, then <b>Export Transactions</b> and choose CSV. Pick that file here.
      New transactions go straight into your budget (as Alex Fun) and are added to the AppleCard tab in the Google Sheet. Anything already there is skipped.
    </p>
    {state && state.waiting > 0 && (
      <>
        <section className="card setlist">
          <div className="setrow static">
            <span className="setlabel"><b>{state.waiting}</b> waiting for the Sheet</span>
            <button className="ghost" onClick={undo} disabled={busy}>Take them back</button>
          </div>
        </section>
        <p className="caption">
          {state.waiting === 1 ? "This imported transaction is" : "These imported transactions are"} waiting to be added to the Sheet.
          {state.note && !state.note.ok && state.note.message ? ` ${state.note.message}` : " They're added at the next sync."}
        </p>
      </>
    )}

    <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
    <button className="primary fullbtn" onClick={() => input.current?.click()} disabled={busy || !state}>
      {busy && !preview ? "Working…" : "Choose CSV file"}
    </button>

    {error && <p className="over small caption" role="alert">{error}</p>}
    {done && <p className="saved small" role="status">{done}</p>}

    {preview && (
      <>
        <h2 className="setgroup-title">{preview.name}</h2>
        <section className="card setlist">
          <div className="setrow static"><span className="setlabel">In the file</span><span className="setvalue">{preview.rows.length}</span></div>
          <div className="setrow static"><span className="setlabel">New{range ? ` (${range})` : ""}</span><span className="setvalue">{preview.fresh.length}</span></div>
          <div className="setrow static"><span className="setlabel">Already in your budget</span><span className="setvalue">{preview.existing}</span></div>
          <div className="setrow static"><span className="setlabel">New, net</span><span className="setvalue">{money2(-net)}</span></div>
        </section>
        {preview.skipped > 0 && <p className="caption">{preview.skipped} unreadable rows skipped.</p>}
        {preview.existing === 0 && state && state.known.size > 0 && preview.fresh.length > 0 && (
          <p className="over small caption">
            None of these match what you already have. If this file overlaps months you pasted into the Sheet before, stop here and check before adding, so nothing is counted twice.
          </p>
        )}
        <button className="primary fullbtn" disabled={busy || !preview.fresh.length} onClick={add}>
          {busy ? "Adding…" : preview.fresh.length ? `Add ${preview.fresh.length}` : "Nothing new to add"}
        </button>
        <button className="linkbtn cancelbtn" onClick={() => setPreview(null)} disabled={busy}>Cancel</button>
      </>
    )}
    </>
  );
}
