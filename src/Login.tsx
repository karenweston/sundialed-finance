import { useState } from "react";
import type { FormEvent } from "react";
import { isDemo, supabase } from "./lib/supabase";

// Email + password. Accounts are created by hand in the Supabase dashboard;
// there is no sign-up screen and sign-ups are closed server-side.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    // One generic message, so the form never reveals which emails have accounts.
    if (error) setMessage("That email or password didn't work.");
    setBusy(false);
  }

  return (
    <main className="center">
      <h1>Sundialed</h1>
      <form onSubmit={signIn}>
        <div className="group">
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        </div>
        <button disabled={busy}>Sign in</button>
      </form>
      {isDemo && <p className="muted">Demo: sign in with any email and password. All data is fictional.</p>}
      {message && <p className="note">{message}</p>}
    </main>
  );
}
