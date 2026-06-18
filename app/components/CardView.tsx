"use client";

import { useEffect, useRef, useState } from "react";
import { idbGet } from "../lib/idb";
import { parseLink } from "../lib/links";
import { publicMediaUrl } from "../lib/supabase";

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
  mediaUrl?: string; // cloud URL — how OTHER devices load single-file media
  mediaPath?: string; // storage path (single file), or chunk base path if chunked
  mediaName?: string;
  mediaType?: string;
  mediaSize?: number;
  mediaChunks?: number; // if >1, media is split into N chunks at `${mediaPath}.part{i}`
}

// Files bigger than this can't be synced even by chunking (free total is ~1GB),
// so they stay on this device only.
const CHUNK_CEILING = 500 * 1024 * 1024;

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
    c.mediaChunks ?? 0,
  ]);
}

interface Props {
  card: Card;
  tilt: { card: number; stamp: number };
  className?: string;
  // Commit this card's draft to state + cloud. The ONLY write path.
  onSave: (id: string, fields: Partial<Card>) => Promise<void> | void;
  // Upload a file and return the media fields for the draft (no commit).
  // `onProgress` reports steps (compressing / uploading 3/12) for the UI.
  onUpload: (file: File, onProgress?: (msg: string) => void) => Promise<Partial<Card> | null>;
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
  const [uploadMsg, setUploadMsg] = useState(""); // attach / save progress
  const [loadMsg, setLoadMsg] = useState<string | null>(null); // chunk-download progress

  const dirty = sig(draft) !== sig(baseRef.current);
  const isMedia = draft.kind === "image" || draft.kind === "video" || draft.kind === "file";

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

  // Resolve the media to show: prefer this device's local copy (instant); else,
  // if it was uploaded in chunks, fetch + stitch the parts back together; else
  // fall back to the single cloud URL (handled by `src`).
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setChecked(false);
    setObjUrl(null);
    setLoadMsg(null);
    const chunks = draft.mediaChunks ?? 0;
    (async () => {
      if (!isMedia) {
        if (!cancelled) setChecked(true);
        return;
      }
      // 1. Local copy on this device?
      if (draft.mediaKey) {
        try {
          const blob = await idbGet(draft.mediaKey);
          if (cancelled) return;
          if (blob) {
            url = URL.createObjectURL(blob);
            setObjUrl(url);
            setChecked(true);
            return;
          }
        } catch {
          if (cancelled) return;
        }
      }
      // 2. Chunked → fetch the parts and reassemble.
      if (chunks > 1 && draft.mediaPath) {
        try {
          const parts: Blob[] = [];
          for (let i = 0; i < chunks; i++) {
            if (cancelled) return;
            setLoadMsg(`receiving ${i + 1}/${chunks}…`);
            const res = await fetch(publicMediaUrl(`${draft.mediaPath}.part${i}`));
            if (!res.ok) throw new Error("missing part");
            parts.push(await res.blob());
          }
          if (cancelled) return;
          url = URL.createObjectURL(
            new Blob(parts, { type: draft.mediaType || "application/octet-stream" })
          );
          setObjUrl(url);
          setLoadMsg(null);
          setChecked(true);
          return;
        } catch {
          if (!cancelled) {
            setLoadMsg(null);
            setChecked(true);
          }
          return;
        }
      }
      // 3. Single cloud URL → `src` falls back to draft.mediaUrl.
      if (!cancelled) setChecked(true);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [isMedia, draft.mediaKey, draft.mediaChunks, draft.mediaPath, draft.mediaType]);

  const src = objUrl || draft.mediaUrl || null;

  function patch(p: Partial<Card>) {
    setDraft({ ...draftRef.current, ...p });
  }

  async function save() {
    const d = draftRef.current;
    baseRef.current = d; // optimistic: we're clean at this content now
    setBusy(true);
    setUploadMsg("saving…");
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
      mediaChunks: d.mediaChunks,
    });
    setBusy(false);
    setUploadMsg("");
    setTooBig(false);
  }

  function revert() {
    baseRef.current = card;
    setDraft(card);
    setTooBig(false);
  }

  async function attach(file: File) {
    setTooBig(file.size > CHUNK_CEILING);
    setBusy(true);
    setUploadMsg("preparing…");
    const m = await onUpload(file, (msg) => setUploadMsg(msg));
    if (m) patch(m);
    setBusy(false);
    setUploadMsg("");
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
      mediaChunks: undefined,
    });
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

  const loadingLabel = <span className="media-loading">{loadMsg || "loading…"}</span>;
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
          loadingLabel
        ))}
      {draft.kind === "video" &&
        (src ? (
          <video src={src} className="media-video" controls playsInline />
        ) : checked ? (
          mediaPlaceholder
        ) : (
          loadingLabel
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
          loadingLabel
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
          over 500 MB — kept on this device only (too large for free sync)
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
        </div>

        <div className="card-bar-right">
          {dirty ? (
            <>
              {busy && <span className="edit-busy">{uploadMsg || "working…"}</span>}
              <button type="button" className="bar-btn" onClick={revert} disabled={busy} title="Discard unsaved changes">
                ↺ revert
              </button>
              <button type="button" className="scratch-btn bar-save" onClick={save} disabled={busy}>
                {busy ? "…" : "save"}
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
