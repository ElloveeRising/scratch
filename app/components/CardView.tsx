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
  text: string; // body for text cards; bottom caption for media cards
  textTop?: string; // top note for media cards (big card only)
  linkUrl?: string; // URL for link cards
  mediaKey?: string; // IndexedDB key for a local copy of the blob
  mediaUrl?: string; // cloud URL — how OTHER devices load this media
  mediaPath?: string; // storage path (for deletion)
  mediaName?: string;
  mediaType?: string;
  mediaSize?: number;
}

interface Props {
  card: Card;
  tilt: { card: number; stamp: number };
  className?: string;
  autoFocus?: boolean;
  onText: (id: string, text: string) => void;
  onTextTop: (id: string, text: string) => void;
  onAttach: (id: string, file: File) => void;
  onLink: (id: string, url: string) => void;
  onWipe: (id: string) => void;
}

function humanSize(n?: number): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CardView({
  card,
  tilt,
  className = "",
  autoFocus,
  onText,
  onTextTop,
  onAttach,
  onLink,
  onWipe,
}: Props) {
  const big = card.size === "big";
  const isMedia = card.kind === "image" || card.kind === "video" || card.kind === "file";
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [objUrl, setObjUrl] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Load a fast local copy from IndexedDB if this device has one. If not, we
  // fall back to the cloud URL (card.mediaUrl) so other devices still see it.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setChecked(false);
    setObjUrl(null);
    if (isMedia && card.mediaKey) {
      idbGet(card.mediaKey)
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
  }, [isMedia, card.mediaKey]);

  const src = objUrl || card.mediaUrl || null;

  function takeFiles(files: FileList | null) {
    const f = files && files[0];
    if (f) onAttach(card.id, f);
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
          onAttach(card.id, blob);
          return;
        }
      }
    }
    if (card.kind === "text" && !card.text.trim()) {
      const t = e.clipboardData.getData("text").trim();
      if (/^https?:\/\/\S+$/i.test(t)) {
        e.preventDefault();
        onLink(card.id, t);
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

  function wipe() {
    if (window.confirm("Erase this whole card? This can’t be undone.")) {
      onWipe(card.id);
    }
  }

  const captionTop = (
    <textarea
      className="caption caption-top"
      spellCheck={false}
      value={card.textTop ?? ""}
      placeholder="write a note…"
      onChange={(e) => onTextTop(card.id, e.target.value)}
    />
  );
  const captionBottom = (
    <textarea
      className="caption"
      spellCheck={false}
      value={card.text}
      placeholder="add a caption…"
      onChange={(e) => onText(card.id, e.target.value)}
    />
  );

  const mediaPlaceholder = card.mediaName ? (
    <span className="media-missing">{card.mediaName} — not available yet</span>
  ) : (
    <span className="media-missing">media not available yet</span>
  );

  return (
    <div
      className={`card ${big ? "is-big" : "is-small"} ${dragging ? "is-drop" : ""} ${className}`}
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

      {card.kind === "text" && (
        <>
          <textarea
            autoFocus={autoFocus}
            spellCheck={false}
            value={card.text}
            onChange={(e) => onText(card.id, e.target.value)}
            className={`flex-1 w-full resize-none outline-none bg-transparent text-ink ${
              big
                ? "text-[15px] leading-[27px] pt-[27px] pl-[60px] pr-6"
                : "text-[13px] leading-[21px] pt-[21px] px-4"
            }`}
          />
          {card.text.trim() && (
            <button type="button" className="card-wipe" title="Erase card" onClick={wipe}>
              ✕
            </button>
          )}
          <button
            type="button"
            className="card-attach"
            title="Attach an image, video, or file"
            onClick={() => fileInput.current?.click()}
          >
            ＋
          </button>
        </>
      )}

      {(card.kind === "image" || card.kind === "video" || card.kind === "file") && (
        <>
          {big && captionTop}
          <div className="media-wrap">
            {card.kind === "image" &&
              (src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={card.mediaName || "image"} className="media-img" />
              ) : checked ? (
                mediaPlaceholder
              ) : (
                <span className="media-loading">loading…</span>
              ))}
            {card.kind === "video" &&
              (src ? (
                <video src={src} className="media-video" controls playsInline />
              ) : checked ? (
                mediaPlaceholder
              ) : (
                <span className="media-loading">loading…</span>
              ))}
            {card.kind === "file" &&
              (src ? (
                <a className="file-chip" href={src} download={card.mediaName} target="_blank" rel="noopener noreferrer">
                  <span className="file-ico">▤</span>
                  <span className="file-meta">
                    <span className="file-name">{card.mediaName || "file"}</span>
                    <span className="file-size">{humanSize(card.mediaSize)} · open / download</span>
                  </span>
                </a>
              ) : checked ? (
                <div className="file-chip file-chip-missing">
                  <span className="file-ico">▤</span>
                  <span className="file-meta">
                    <span className="file-name">{card.mediaName || "file"}</span>
                    <span className="file-size">not available yet</span>
                  </span>
                </div>
              ) : (
                <span className="media-loading">loading…</span>
              ))}
            <div className="card-tools">
              {src && card.kind !== "file" && (
                <a className="tool-btn" href={src} download={card.mediaName} target="_blank" rel="noopener noreferrer" title="Download">
                  ⭳
                </a>
              )}
              <button type="button" onClick={wipe} title="Erase card">
                ✕
              </button>
            </div>
          </div>
          {captionBottom}
        </>
      )}

      {card.kind === "link" &&
        (() => {
          const info = parseLink(card.linkUrl || card.text);
          return (
            <>
              {big && captionTop}
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
                <div className="card-tools">
                  <button type="button" onClick={copyLink} title="Copy link">
                    ⧉
                  </button>
                  <button type="button" onClick={wipe} title="Erase card">
                    ✕
                  </button>
                </div>
              </div>
              {captionBottom}
            </>
          );
        })()}
    </div>
  );
}
