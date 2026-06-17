"use client";

import { useEffect, useRef, useState } from "react";
import { idbGet } from "../lib/idb";
import { parseLink } from "../lib/links";

export type Kind = "text" | "image" | "video" | "file" | "link";

export interface Card {
  id: string;
  label: string;
  size: "big" | "small";
  kind: Kind;
  text: string; // body for text cards; caption for media/link cards
  textTop?: string; // top note for media cards (big card only)
  linkUrl?: string; // URL for link cards
  mediaKey?: string; // IndexedDB key for a local copy of the blob
  mediaUrl?: string; // cloud URL — how OTHER devices load this media
  mediaPath?: string; // storage path (for deletion)
  mediaName?: string;
  mediaType?: string;
  mediaSize?: number;
}

// Supabase free tier rejects single uploads over 50MB. Until chunked uploads
// land, anything bigger is kept on-device only (no long doomed upload).
const MAX_SYNC_BYTES = 50 * 1024 * 1024;

// Minimal shape of the Web Speech API we use (it isn't in the TS DOM lib).
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: { results: { length: number; [i: number]: { [j: number]: { transcript: string } } } }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecCtor = new () => SpeechRec;

function getSpeechRecCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// Content signature — the fields that actually sync. Excludes device-local
// `mediaKey` so the same media isn't seen as a change across devices. Used to
// tell whether a card has unsaved local edits ("dirty").
function sig(c: Card): string {
  return JSON.stringify([
    c.kind,
    c.text ?? "",
    c.textTop ?? "",
    c.linkUrl ?? "",
    c.mediaUrl ?? "",
    c.mediaPath ?? "",
    c.mediaName ?? "",
    c.mediaType ?? "",
    c.mediaSize ?? 0,
  ]);
}

interface Props {
  card: Card;
  tilt: { card: number; stamp: number };
  className?: string;
  // Commit this card's draft to state + cloud. The ONLY write path.
  onSave: (id: string, fields: Partial<Card>) => Promise<void> | void;
  // Upload a file and return the media fields for the draft (no commit).
  onUpload: (file: File) => Promise<Partial<Card> | null>;
  // If provided, show a Share button (used only on the one shareable card).
  onShare?: () => void;
}

function humanSize(n?: number): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CardView({ card, tilt, className = "", onSave, onUpload, onShare }: Props) {
  const big = card.size === "big";
  const fileInput = useRef<HTMLInputElement | null>(null);

  // The card is always directly editable. `draft` is the working copy; `base`
  // is the last content we synced/saved. dirty = draft differs from base.
  const [draft, setDraftState] = useState<Card>(card);
  const draftRef = useRef<Card>(card);
  const baseRef = useRef<Card>(card);
  const setDraft = (next: Card) => {
    draftRef.current = next;
    setDraftState(next);
  };

  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tooBig, setTooBig] = useState(false);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const dictBaseRef = useRef("");

  const dirty = sig(draft) !== sig(baseRef.current);
  const isMedia = draft.kind === "image" || draft.kind === "video" || draft.kind === "file";

  useEffect(() => {
    setCanDictate(!!getSpeechRecCtor());
  }, []);

  // Adopt incoming synced content ONLY when there are no unsaved edits. While
  // dirty, hold our draft so a sync from the other device can't wipe what
  // you're typing — this is what keeps cross-device editing safe. (Mirrors what
  // the old "edit mode" draft did; only the trigger changed.)
  const cardSig = sig(card);
  useEffect(() => {
    if (sig(draftRef.current) === sig(baseRef.current)) {
      baseRef.current = card;
      setDraft(card);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardSig]);

  // Load a fast local copy from IndexedDB if present; else fall back to cloud URL.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setChecked(false);
    setObjUrl(null);
    if (isMedia && draft.mediaKey) {
      idbGet(draft.mediaKey)
        .then((blob) => {
          if (cancelled) return;
          if (blob) {
            url = URL.createObjectURL(blob);
            setObjUrl(url);
          }
          setChecked(true);
        })
        .catch(() => {
          if (!cancelled) setChecked(true);
        });
    } else {
      setChecked(true);
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [isMedia, draft.mediaKey]);

  // Release the mic if the card unmounts mid-dictation.
  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const src = objUrl || draft.mediaUrl || null;

  function patch(p: Partial<Card>) {
    setDraft({ ...draftRef.current, ...p });
  }

  function stopDictation() {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  }

  async function save() {
    stopDictation();
    const d = draftRef.current;
    baseRef.current = d; // optimistic: we're clean at this content now
    setBusy(true);
    await onSave(card.id, {
      kind: d.kind,
      text: d.text ?? "",
      textTop: d.textTop,
      linkUrl: d.linkUrl,
      mediaKey: d.mediaKey,
      mediaUrl: d.mediaUrl,
      mediaPath: d.mediaPath,
      mediaName: d.mediaName,
      mediaType: d.mediaType,
      mediaSize: d.mediaSize,
    });
    setBusy(false);
    setTooBig(false);
  }

  function revert() {
    stopDictation();
    baseRef.current = card;
    setDraft(card);
    setTooBig(false);
  }

  async function attach(file: File) {
    setTooBig(file.size > MAX_SYNC_BYTES);
    setBusy(true);
    const m = await onUpload(file);
    if (m) patch(m);
    setBusy(false);
  }
  function takeFiles(files: FileList | null) {
    const f = files && files[0];
    if (f) attach(f);
  }

  // Remove the media/link, back to a plain text card (the caption becomes the
  // body). Committed on Save like any other edit.
  function removeMedia() {
    setTooBig(false);
    patch({
      kind: "text",
      linkUrl: undefined,
      mediaKey: undefined,
      mediaUrl: undefined,
      mediaPath: undefined,
      mediaName: undefined,
      mediaType: undefined,
      mediaSize: undefined,
    });
  }

  function toggleDictation() {
    if (listening) {
      stopDictation();
      return;
    }
    const Ctor = getSpeechRecCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    dictBaseRef.current = (draftRef.current.text ?? "").trim();
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      const base = dictBaseRef.current;
      patch({ text: base ? `${base} ${transcript}` : transcript });
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    rec.onerror = () => {
      recRef.current = null;
      setListening(false);
    };
    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      /* mic unavailable / permission denied */
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length) takeFiles(e.dataTransfer.files);
  }
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const blob = items[i].getAsFile();
        if (blob) {
          e.preventDefault();
          attach(blob);
          return;
        }
      }
    }
    if (draftRef.current.kind === "text" && !(draftRef.current.text ?? "").trim()) {
      const t = e.clipboardData.getData("text").trim();
      if (/^https?:\/\/\S+$/i.test(t)) {
        e.preventDefault();
        patch({ kind: "link", linkUrl: t, text: "" });
      }
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(draft.linkUrl || draft.text);
    } catch {
      /* clipboard unavailable */
    }
  }

  const textClass = big
    ? "text-[15px] leading-[27px] pt-[27px] pl-[60px] pr-6"
    : "text-[13px] leading-[21px] pt-[21px] px-4";

  const mediaPlaceholder = draft.mediaName ? (
    <span className="media-missing">{draft.mediaName} — not synced yet</span>
  ) : (
    <span className="media-missing">media not available yet</span>
  );

  const mediaBlock = (
    <div className="media-wrap">
      {draft.kind === "image" &&
        (src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={draft.mediaName || "image"} className="media-img" />
        ) : checked ? (
          mediaPlaceholder
        ) : (
          <span className="media-loading">loading…</span>
        ))}
      {draft.kind === "video" &&
        (src ? (
          <video src={src} className="media-video" controls playsInline />
        ) : checked ? (
          mediaPlaceholder
        ) : (
          <span className="media-loading">loading…</span>
        ))}
      {draft.kind === "file" &&
        (src ? (
          <a
            className="file-chip"
            href={src}
            download={draft.mediaName}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="file-ico">▤</span>
            <span className="file-meta">
              <span className="file-name">{draft.mediaName || "file"}</span>
              <span className="file-size">{humanSize(draft.mediaSize)} · open / download</span>
            </span>
          </a>
        ) : checked ? (
          <div className="file-chip file-chip-missing">
            <span className="file-ico">▤</span>
            <span className="file-meta">
              <span className="file-name">{draft.mediaName || "file"}</span>
              <span className="file-size">not synced yet</span>
            </span>
          </div>
        ) : (
          <span className="media-loading">loading…</span>
        ))}
    </div>
  );

  const linkBlock = (() => {
    const info = parseLink(draft.linkUrl || draft.text);
    return (
      <div className="media-wrap link-wrap">
        {info.embedUrl ? (
          <iframe
            className="link-embed"
            src={info.embedUrl}
            title={info.domain}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <a className="link-chip" href={info.url} target="_blank" rel="noopener noreferrer">
            <span className="link-ico">↗</span>
            <span className="link-meta">
              <span className="link-domain">{info.domain}</span>
              <span className="link-url">{info.url}</span>
            </span>
          </a>
        )}
      </div>
    );
  })();

  return (
    <div
      className={`card ${big ? "is-big" : "is-small"} ${dirty ? "is-dirty" : ""} ${
        dragging ? "is-drop" : ""
      } ${className}`}
      style={{ transform: `rotate(${tilt.card}deg)` }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <span className="card-stamp" style={{ transform: `rotate(${tilt.stamp}deg)` }}>
        {card.label}
      </span>

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          takeFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* ── Content (always editable) ─────────────────────────────── */}
      {draft.kind === "text" && (
        <textarea
          spellCheck={false}
          value={draft.text}
          placeholder="write here…"
          onChange={(e) => patch({ text: e.target.value })}
          className={`flex-1 w-full resize-none outline-none bg-transparent text-ink ${textClass}`}
        />
      )}

      {isMedia && (
        <>
          {big && (
            <textarea
              className="caption caption-top"
              spellCheck={false}
              value={draft.textTop ?? ""}
              placeholder="write a note…"
              onChange={(e) => patch({ textTop: e.target.value })}
            />
          )}
          {mediaBlock}
          <textarea
            className="caption"
            spellCheck={false}
            value={draft.text}
            placeholder="add a caption…"
            onChange={(e) => patch({ text: e.target.value })}
          />
        </>
      )}

      {draft.kind === "link" && (
        <>
          {big && (
            <textarea
              className="caption caption-top"
              spellCheck={false}
              value={draft.textTop ?? ""}
              placeholder="write a note…"
              onChange={(e) => patch({ textTop: e.target.value })}
            />
          )}
          {linkBlock}
          <textarea
            className="caption"
            spellCheck={false}
            value={draft.text}
            placeholder="add a caption…"
            onChange={(e) => patch({ text: e.target.value })}
          />
        </>
      )}

      {tooBig && (
        <div className="media-note">
          kept on this device — too big to sync yet (we’re working on it)
        </div>
      )}

      {/* ── Action bar ────────────────────────────────────────────── */}
      <div className="card-bar">
        <div className="card-bar-left">
          <button
            type="button"
            className="bar-btn"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            title="Attach or replace an image, video, or file"
          >
            ＋ {isMedia || draft.kind === "link" ? "replace" : "attach"}
          </button>
          {(isMedia || draft.kind === "link") && (
            <button
              type="button"
              className="bar-btn"
              onClick={removeMedia}
              disabled={busy}
              title="Remove the media/link"
            >
              ✕ remove
            </button>
          )}
          {canDictate && (
            <button
              type="button"
              className={`bar-btn ${listening ? "is-live" : ""}`}
              onClick={toggleDictation}
              disabled={busy}
              title="Dictate with your voice"
            >
              {listening ? "● listening" : "🎤 speak"}
            </button>
          )}
        </div>

        <div className="card-bar-right">
          {dirty ? (
            <>
              {busy && <span className="edit-busy">working…</span>}
              <button type="button" className="bar-btn" onClick={revert} disabled={busy} title="Discard unsaved changes">
                ↺ revert
              </button>
              <button type="button" className="scratch-btn bar-save" onClick={save} disabled={busy}>
                {busy ? "saving…" : "save"}
              </button>
            </>
          ) : (
            <>
              {src && isMedia && (
                <a
                  className="bar-btn"
                  href={src}
                  download={draft.mediaName}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Download to this device"
                >
                  ⭳ download
                </a>
              )}
              {draft.kind === "link" && (
                <button type="button" className="bar-btn" onClick={copyLink} title="Copy the link">
                  ⧉ copy
                </button>
              )}
              {onShare && (
                <button type="button" className="bar-btn" onClick={onShare} title="Share this card">
                  ▦ share
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
