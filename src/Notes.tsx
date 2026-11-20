import { useState } from "react";
import type { Note } from "./lib/data";

interface Props {
  notes: Note[]; // this month's notes, oldest first
  nameOf: (n: Note) => string;
  uid: string | null;
  onAdd: (body: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

/** A small, shared list of things to talk about. Each note shows who added it. */
const OPEN_KEY = "sundialed.notesOpen";

export default function Notes({ notes, nameOf, uid, onAdd, onDelete }: Props) {
  const [open, setOpenState] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch { /* storage unavailable */ }
  };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(body);
      setText("");
    } catch (e) {
      const why = e instanceof Error ? e.message : (e as { message?: string })?.message;
      setError(`Couldn't save that note${why ? `: ${why}` : ""}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (armed !== id) { setArmed(id); return; }
    setError("");
    try { await onDelete(id); setArmed(null); }
    catch { setError("Couldn't remove that note."); }
  }

  return (
    <section className="section notes" aria-label="Notes">
      <div className="grouphead">
        <h2>Notes{notes.length > 0 && <span className="muted"> · {notes.length}</span>}</h2>
        <button className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && <div className="card">
        {notes.map((n) => {
          const who = nameOf(n);
          const mine = n.author_id === uid;
          return (
            <div key={n.id} className="note">
              <span className={`avatar${mine ? " me" : ""}`} aria-hidden="true">{who.charAt(0).toUpperCase()}</span>
              <div className="note-main">
                <div className="note-meta">
                  <span className="note-who">{who}</span>
                  <span>{new Date(n.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                </div>
                <p>{n.body}</p>
              </div>
              {mine && (
                <button className={`note-x${armed === n.id ? " armed" : ""}`} onClick={() => remove(n.id)} aria-label={armed === n.id ? "Tap again to remove this note" : "Remove this note"}>
                  {armed === n.id ? "Remove" : (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  )}
                </button>
              )}
            </div>
          );
        })}
        <form className="noteform" onSubmit={add}>
          <input value={text} maxLength={1000} placeholder="Enter a note" aria-label="New note" onChange={(e) => setText(e.target.value)} />
          <button className="sendbtn" type="submit" disabled={busy || !text.trim()} aria-label="Add note">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </form>
        {error && <p className="over small" role="alert">{error}</p>}
      </div>}
    </section>
  );
}
