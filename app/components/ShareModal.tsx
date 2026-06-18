"use client";

import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import type { Card } from "./CardView";
import { supabase } from "../lib/supabase";

type Phase = "creating" | "ready" | "signedout" | "error";

// Build a retro QR (ink modules on manila) as an inline SVG string.
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const margin = 2;
  const size = n + margin * 2;
  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) {
        rects += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" width="100%" height="100%"><rect width="${size}" height="${size}" fill="#ecdca6"/><g fill="#1c1b1a">${rects}</g></svg>`;
}

function slugId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
  } catch {
    /* fall through */
  }
  return `s${Date.now().toString(36)}${Math.round(Math.random() * 1e9).toString(36)}`;
}

export default function ShareModal({ card, onClose }: { card: Card; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("creating");
  const [url, setUrl] = useState("");
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  // On open, snapshot the card to a public JSON in storage and build the link.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const sb = supabase;
      if (!sb) {
        setPhase("error");
        return;
      }
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) {
        setPhase("signedout");
        return;
      }
      try {
        const slug = slugId();
        const snapshot = {
          v: 1,
          sharedAt: Date.now(),
          card: {
            kind: card.kind,
            text: card.text ?? "",
            textTop: card.textTop ?? "",
            linkUrl: card.linkUrl ?? "",
            mediaUrl: card.mediaUrl ?? "",
            mediaPath: card.mediaPath ?? "",
            mediaName: card.mediaName ?? "",
            mediaType: card.mediaType ?? "",
            mediaSize: card.mediaSize ?? 0,
            mediaChunks: card.mediaChunks ?? 0,
          },
        };
        const path = `${uid}/shares/${slug}.json`;
        const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
        const { error } = await sb.storage
          .from("media")
          .upload(path, blob, { contentType: "application/json", upsert: true });
        if (error) {
          setPhase("error");
          return;
        }
        const shareUrl = `${window.location.origin}/s/${uid}.${slug}`;
        setUrl(shareUrl);
        setSvg(qrSvg(shareUrl));
        setPhase("ready");
      } catch {
        setPhase("error");
      }
    })();
  }, [card]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }
  async function nativeShare() {
    try {
      await navigator.share({ title: "Shared from Scratch Pad", url });
    } catch {
      /* user cancelled or unsupported */
    }
  }

  return (
    <div className="connect-overlay" onClick={onClose}>
      <div className="connect-panel share-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="connect-close" onClick={onClose} title="Close">
          ✕
        </button>
        <h2 className="connect-title">SHARE THIS CARD</h2>

        {phase === "creating" && <p className="connect-sub">Preparing a shareable copy…</p>}

        {phase === "signedout" && (
          <p className="connect-sub">
            Connect (sign in) first — sharing uploads a read-only copy others can open.
          </p>
        )}

        {phase === "error" && (
          <p className="connect-sub">Couldn’t create the share just now. Please try again.</p>
        )}

        {phase === "ready" && (
          <>
            <p className="connect-sub">
              Scan this, or send the link — anyone can open this card with no app and no login.
            </p>
            <div className="qr-frame">
              <div className="qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
            <div className="share-link">{url}</div>
            <div className="share-actions">
              <button type="button" className="scratch-btn" onClick={copy}>
                {copied ? "COPIED ✓" : "COPY LINK"}
              </button>
              {canNativeShare && (
                <button type="button" className="scratch-btn" onClick={nativeShare}>
                  SHARE…
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
