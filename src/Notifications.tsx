import { useEffect, useState } from "react";
import { disablePush, enablePush, listDevices, pushState, removeDevice } from "./lib/push";
import type { Device, PushState } from "./lib/push";
import { isMissingTable } from "./lib/rules";
import { isDemo } from "./lib/supabase";

export default function Notifications() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const loadDevices = () => listDevices().then(setDevices).catch(() => setDevices(null));

  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
    loadDevices();
  }, []);

  async function remove(d: Device) {
    if (armed !== d.endpoint) { setArmed(d.endpoint); return; }
    setBusy(true);
    setError("");
    try {
      if (d.here) setState(await disablePush());
      else await removeDevice(d.endpoint);
      setArmed(null);
      await loadDevices();
    } catch {
      setError("Couldn't remove that. Try again.");
    }
    setBusy(false);
  }

  async function run(action: () => Promise<PushState>) {
    setBusy(true);
    setError("");
    try {
      setState(await action());
    } catch (e) {
      const why = e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? "";
      setError(
        isMissingTable(e) || /42P01|PGRST205/.test(why)
          ? "Notifications need the latest database update, which hasn't been applied yet."
          : `Couldn't change that${why ? `: ${why}` : ""}. Try again.`,
      );
    }
    setBusy(false);
  }

  const toggleable = state === "on" || state === "off";
  const note =
    "On this phone only. You’ll get a heads-up when a pinned line at the top reaches halfway, three-quarters or 90% of its target, or goes over, and a short check-in on Sunday evenings. They use words, not dollar amounts, so nothing sensitive shows on your lock screen.";

  return (
    <>
    {toggleable ? (
      <section className="card setlist">
        <div className="setrow static">
          <span className="setlabel" id="notif-label">Notifications</span>
          <button className={`switch ${state === "on" ? "on" : ""}`} role="switch" aria-checked={state === "on"} aria-labelledby="notif-label" disabled={busy} onClick={() => run(state === "on" ? disablePush : enablePush)}>
            <span />
          </button>
        </div>
      </section>
    ) : (
      <section className="card">
        {state === "needs-install" && (
          <p className="small">
            iPhone only allows notifications from the Home Screen app. In Safari, tap Share, then <strong>Add to Home Screen</strong>,
            open Sundialed from the new icon, and come back to this screen.
          </p>
        )}
        {state === "blocked" && (
          <p className="small">Notifications are blocked. Turn them on in the iPhone Settings app under Notifications, then Sundialed.</p>
        )}
        {state === "no-key" && <p className="muted small">{isDemo ? "Notifications are off in the demo. The live app sends them from a server after each sync." : "Notifications aren't set up on the server yet."}</p>}
        {state === "unsupported" && <p className="muted small">This browser can't receive notifications.</p>}
        {state === null && <p className="muted small">Checking…</p>}
      </section>
    )}
    {error && <p className="over small caption" role="alert">{error}</p>}
    <p className="caption">{note}</p>

    {devices && devices.length > 0 && (
      <>
        <h2 className="setgroup-title">Your devices</h2>
        <section className="card">
          <ul className="plain devices">
            {devices.map((d) => (
              <li key={d.endpoint}>
                <span>
                  <span className="tx-name">{d.label ?? "Device"}{d.here && <span className="tag"> This one</span>}</span>
                  <span className="muted small"> Added {new Date(d.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                </span>
                <button className={armed === d.endpoint ? "danger" : "ghost"} disabled={busy} onClick={() => remove(d)}>
                  {armed === d.endpoint ? "Tap again to remove" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <p className="caption">Every phone or browser you've turned notifications on for. Reinstalling the app adds a new one, so remove the old ones here.</p>
      </>
    )}
    </>
  );
}
