"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

// Minimal magic-link sign-in panel. No passwords — enter an email, get a link,
// tap it on any device to sync that device to your board.
export default function Connect({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const sb = supabase;
    if (!sb || !email.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setErr(error.message);
      else setSent(true);
    } catch {
      setErr("Something went wrong — please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="connect-overlay" onClick={onClose}>
      <div className="connect-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="connect-close" onClick={onClose} title="Close">
          ✕
        </button>

        {!sent ? (
          <>
            <h2 className="connect-title">SYNC ACROSS DEVICES</h2>
            <p className="connect-sub">
              Enter your email and we will send a magic link. Open it on your
              phone and your laptop to mirror this board between them.
            </p>
            <form onSubmit={send}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="connect-input"
                autoFocus
              />
              <button type="submit" className="scratch-btn connect-send" disabled={busy}>
                {busy ? "SENDING…" : "SEND MAGIC LINK"}
              </button>
            </form>
            {err && <p className="connect-err">{err}</p>}
          </>
        ) : (
          <>
            <h2 className="connect-title">CHECK YOUR EMAIL ✉️</h2>
            <p className="connect-sub">
              We sent a link to <b>{email}</b>. Tap it on any device — phone or
              laptop — to sync this board there. Check spam if it is slow.
            </p>
            <button type="button" className="scratch-btn" onClick={onClose}>
              DONE
            </button>
          </>
        )}
      </div>
    </div>
  );
}
