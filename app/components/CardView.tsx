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

interface Props {
  card: Card;
  tilt: { card: number; stamp: number };
  className?: string;
  // Commit this card's draft to state + cloud. The ONLY write path.
  onSave: (id: string, fields: Partial<Card>) => Promise<void> | void;
  // Upload a file and return the media fields for the draft (no commit).
  onUpload: (file: File) => Promise<Partial<Card> | null>;
}

function humanSize(n?: number): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CardView({ card, tilt, className = "", onSave, onUpload }: Props) {
  const big = card.size === "big";
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Edit state: a private draft that only becomes real on Save.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tooBig, setTooBig] = useState(false);

  // Media preview
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Dictation (Web Speech API)
  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const dictBaseRef = useRef("");

  useEffect(() => {
    setCanDictate(!!getSpeechRecCtor());
  }, []);

  // What we render: the draft while editing, otherwise the synced card.
  const shown = editing && draft ? draft : card;
  const isMedia = shown.kind === "image" || shown.kind === "video" || shown.kind === "file";

  // Load a fast local copy from IndexedDB if this device has one; otherwise fall
  // back to the cloud URL so other devices still see the media.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setChecked(false);
    setObjUrl(null);
    if (isMedia && shown.mediaKey) {
      idbGet(shown.mediaKey)
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
  }, [isMedia, shown.mediaKey]);

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

  const src = objUrl || shown.mediaUrl || null;

  function stopDictation() {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    recRef.current = null;
    setListening(false);
  }

  function startEdit() {
    setDraft({ ...card });
    setTooBig(false);
    setEditing(true);
  }
  function cancel() {
    stopDictation();
    setEditing(false);
    setDraft(null);
    setDragging(false);
    setTooBig(false);
    setBusy(false);
  }
  function patch(p: Partial<Card>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  async function save() {
    if (!draft) return;
    stopDictation();
    setBusy(true);
    await onSave(card.id, {
      kind: draft.kind,
      text: draft.text ?? "",
      textTop: draft.textTop,
      linkUrl: draft.linkUrl,
      mediaKey: draft.mediaKey,
      mediaUrl: draft.mediaUrl,
      mediaPath: draft.mediaPath,
      mediaName: draft.mediaName,
      mediaType: draft.mediaType,
      mediaSize: draft.mediaSize,
    });
    setBusy(false);
    setEditing(false);
    setDraft(null);
    setDragging(false);
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

  // Clear everything back to an empty text card (committed on Save).
  function clearAll() {
    setTooBig(false);
    patch({
      kind: "text",
      text: "",
      textTop: undefined,
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
    if (!Ctor || !draft) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    dictBaseRef.current = (draft.text ?? "").trim();
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
    if (!editing) return;
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length) takeFiles(e.dataTransfer.files);
  }
  function handlePaste(e: React.ClipboardEvent) {
    if (!editing || !draft) return;
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
    if (draft.kind === "text" && !(draft.text ?? "").trim()) {
      const t = e.clipboardData.getData("text").trim();
      if (/^https?:\/\/\S+$/i.test(t)) {
        e.preventDefault();
        patch({ kind: "link", linkUrl: t, text: "" });
      }
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(card.linkUrl || card.text);
    } catch {
      /* clipboard unavailable */
    }
  }

  const textClass = big
    ? "text-[15px] leading-[27px] pt-[27px] pl-[60px] pr-6"
    : "text-[13px] leading-[21px] pt-[21px] px-4";

  // ── Media block (shared by view + edit) ─────────────────────────────
  const mediaPlaceholder = shown.mediaName ? (
    <span className="media-missing">{shown.mediaName} — not synced yet</span>
  ) : (
    <span className="media-missing">media not available yet</span>
  );

  const mediaBlock = (
    <div className="media-wrap">
      {shown.kind === "image" &&
        (src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={shown.mediaName || "image"} className="media-img" />
        ) : checked ? (
          mediaPlaceholder
        ) : (
          <span className="media-loading">loading…</span>
        ))}
      {shown.kind === "video" &&
        (src ? (
          <video src={src} className="media-video" controls playsInline />
        ) : checked ? (
          mediaPlaceholder
        ) : (
          <span className="media-loading">loading…</span>
        ))}
      {shown.kind === "file" &&
        (src ? (
          <a
            className="file-chip"
            href={src}
            download={shown.mediaName}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="file-ico">▤</span>
            <span className="file-meta">
              <span className="file-name">{shown.mediaName || "file"}</span>
              <span className="file-size">{humanSize(shown.mediaSize)} · open / download</span>
            </span>
          </a>
        ) : checked ? (
          <div className="file-chip file-chip-missing">
            <span className="file-ico">▤</span>
            <span className="file-meta">
              <span className="file-name">{shown.mediaName || "file"}</span>
              <span className="file-size">not synced yet</span>
            </span>
          </div>
        ) : (
          <span className="media-loading">loading…</span>
        ))}
      {editing && (
        <div className="card-tools">
          <button type="button" onClick={clearAll} title="Remove media">
            ✕
          </button>
        </div>
      )}
    </div>
  );

  const linkBlock = (() => {
    const info = parseLink(shown.linkUrl || shown.text);
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
        {editing && (
          <div className="card-tools">
            <button type="button" onClick={clearAll} title="Remove link">
              ✕
            </button>
          </div>
        )}
      </div>
    );
  })();

  return (
    <div
      className={`card ${big ? "is-big" : "is-small"} ${editing ? "is-editing" : ""} ${
        dragging ? "is-drop" : ""
      } ${className}`}
      style={{ transform: `rotate(${tilt.card}deg)` }}
      onDragOver={(e) => {
        if (!editing) return;
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

      {/* ── VIEW MODE ─────────────────────────────────────────────── */}
      {!editing && (
        <>
          {card.kind === "text" && (
            <div className={`card-text-view flex-1 w-full ${textClass}`}>
              {card.text ? (
                card.text
              ) : (
                <span className="card-empty">empty — tap edit to add something</span>
              )}
            </div>
          )}
          {(card.kind === "image" || card.kind === "video" || card.kind === "file") && (
            <>
              {big && card.textTop && <div className="caption caption-top">{card.textTop}</div>}
              {mediaBlock}
              {card.text && <div className="caption">{card.text}</div>}
            </>
          )}
          {card.kind === "link" && (
            <>
              {big && card.textTop && <div className="caption caption-top">{card.textTop}</div>}
              {linkBlock}
              {card.text && <div className="caption">{card.text}</div>}
            </>
          )}

          <div className="card-view-tools">
            {src && isMedia && (
              <a
                className="card-btn"
                href={src}
                download={card.mediaName}
                target="_blank"
                rel="noopener noreferrer"
                title="Download"
              >
                ⭳
              </a>
            )}
            {card.kind === "link" && (
              <button type="button" className="card-btn" onClick={copyLink} title="Copy link">
                ⧉
              </button>
            )}
            <button type="button" className="card-btn" onClick={startEdit}>
              ✎ edit
            </button>
          </div>
        </>
      )}

      {/* ── EDIT MODE ─────────────────────────────────────────────── */}
      {editing && draft && (
        <>
          {(draft.kind === "image" || draft.kind === "video" || draft.kind === "file") &&
            mediaBlock}
          {draft.kind === "link" && linkBlock}

          {tooBig && (
            <div className="media-note">
              kept on this device — too big to sync yet (we’re working on it)
            </div>
          )}

          <textarea
            autoFocus
            spellCheck={false}
            value={draft.text ?? ""}
            placeholder={isMedia || draft.kind === "link" ? "add a caption…" : "write…"}
            onChange={(e) => patch({ text: e.target.value })}
            className={
              isMedia || draft.kind === "link"
                ? "caption"
                : `flex-1 w-full resize-none outline-none bg-transparent text-ink ${textClass}`
            }
          />

          <div className="edit-bar">
            <div className="edit-bar-left">
              <button
                type="button"
                className="card-attach-edit"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                title="Attach or replace an image, video, or file"
              >
                ＋ {isMedia ? "replace" : "attach"}
              </button>
              {canDictate && (
                <button
                  type="button"
                  className={`card-mic ${listening ? "is-live" : ""}`}
                  onClick={toggleDictation}
                  disabled={busy}
                  title="Dictate with your voice"
                >
                  {listening ? "● listening" : "🎤 speak"}
                </button>
              )}
            </div>
            <div className="edit-bar-right">
              {busy && <span className="edit-busy">working…</span>}
              <button type="button" className="edit-cancel" onClick={cancel}>
                cancel
              </button>
              <button type="button" className="scratch-btn edit-save" onClick={save} disabled={busy}>
                {busy ? "saving…" : "save"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
