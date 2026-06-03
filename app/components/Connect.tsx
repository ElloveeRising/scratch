"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";

// Sign-in via a 6-digit email code (with the magic link as a backup). The code
// is far more reliable on phones: you type it into the SAME browser the app is
// open in, so there is no "link opened in a different browser" problem and
// nothing single-use to accidentally consume on another device.
export default function Connect({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
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

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const sb = supabase;
    const token = code.replace(/\D/g, "");
    if (!sb || !token) return;
    setBusy(true);
    setErr(null);
    try {
      const { error } = await sb.auth.verifyOtp({
        email: email.trim(),
        token,
        type: "email",
      });
      if (error) setErr("That code did not work — check it, or send a new one.");
      else onClose(); // signed in; the app picks up the session
    } catch {
      setErr("That code did not work — check it, or send a new one.");
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
              Enter your email and we will send a sign-in code. Do this once on
              each device — phone and laptop — to mirror your board between them.
            </p>
            <form onSubmit={sendCode}>
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
                {busy ? "SENDING…" : "SEND CODE"}
              </button>
            </form>
            {err && <p className="connect-err">{err}</p>}
          </>
        ) : (
          <>
            <h2 className="connect-title">ENTER YOUR CODE</h2>
            <p className="connect-sub">
              We emailed a sign-in code to <b>{email}</b>. Type the whole code
              here on THIS device. (Tapping the link in the same email works too.)
            </p>
            <form onSubmit={verifyCode}>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="12345678"
                className="connect-input connect-code"
                autoFocus
              />
              <button type="submit" className="scratch-btn connect-send" disabled={busy}>
                {busy ? "CHECKING…" : "CONNECT"}
              </button>
            </form>
            {err && <p className="connect-err">{err}</p>}
            <button
              type="button"
              className="connect-resend"
              onClick={() => {
                setSent(false);
                setCode("");
                setErr(null);
              }}
            >
              use a different email / resend
            </button>
          </>
        )}
      </div>
    </div>
  );
}
