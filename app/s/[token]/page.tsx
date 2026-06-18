import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { publicMediaUrl } from "../../lib/supabase";
import { parseLink } from "../../lib/links";

interface SharedCard {
  kind: string;
  text: string;
  textTop: string;
  linkUrl: string;
  mediaUrl: string;
  mediaPath: string;
  mediaName: string;
  mediaType: string;
  mediaSize: number;
  mediaChunks: number;
}

// Fetch a shared card snapshot from the public media bucket. `cache` dedupes
// the fetch between generateMetadata and the page render.
const getShare = cache(async (token: string): Promise<SharedCard | null> => {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const uid = token.slice(0, dot);
  const slug = token.slice(dot + 1);
  if (!/^[a-zA-Z0-9-]+$/.test(uid) || !/^[a-zA-Z0-9]+$/.test(slug)) return null;
  try {
    const res = await fetch(publicMediaUrl(`${uid}/shares/${slug}.json`), { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { card?: SharedCard };
    return data?.card ?? null;
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const card = await getShare(token);
  if (!card) return { title: "Scratch Pad" };
  const desc = (card.text || card.textTop || "A card shared from Scratch Pad").slice(0, 120);
  const image = card.kind === "image" && card.mediaUrl ? [card.mediaUrl] : undefined;
  return {
    title: "Shared from Scratch Pad",
    description: desc,
    openGraph: { title: "Shared from Scratch Pad", description: desc, images: image },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await getShare(token);

  if (!card) {
    return (
      <div className="desk share-page">
        <div className="card is-big share-card">
          <span className="card-stamp">404</span>
          <div className="share-empty">
            This shared card isn’t available.
            <br />
            It may have been removed.
          </div>
          <Link className="share-made" href="/">
            made with Scratch Pad
          </Link>
        </div>
      </div>
    );
  }

  const isImage = card.kind === "image" && card.mediaUrl;
  const isVideo = card.kind === "video" && card.mediaUrl;
  const isFile = card.kind === "file" && card.mediaUrl;
  const isLink = card.kind === "link" && (card.linkUrl || card.text);
  const isMedia = isImage || isVideo || isFile;
  // Chunked media has no single URL — too large to reassemble on a public page.
  const isChunked =
    (card.kind === "image" || card.kind === "video" || card.kind === "file") &&
    !card.mediaUrl &&
    (card.mediaChunks ?? 0) > 1;
  const link = isLink ? parseLink(card.linkUrl || card.text) : null;

  return (
    <div className="desk share-page">
      <div className="card is-big share-card">
        <span className="card-stamp">CARD</span>

        {card.textTop ? <div className="caption caption-top">{card.textTop}</div> : null}

        {isImage ? (
          <div className="media-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.mediaUrl} alt={card.mediaName || "image"} className="media-img" />
          </div>
        ) : null}

        {isVideo ? (
          <div className="media-wrap">
            <video src={card.mediaUrl} className="media-video" controls playsInline />
          </div>
        ) : null}

        {isFile ? (
          <div className="media-wrap">
            <a
              className="file-chip"
              href={card.mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="file-ico">▤</span>
              <span className="file-meta">
                <span className="file-name">{card.mediaName || "file"}</span>
                <span className="file-size">open / download</span>
              </span>
            </a>
          </div>
        ) : null}

        {isChunked ? (
          <div className="media-wrap">
            <div className="file-chip file-chip-missing">
              <span className="file-ico">▤</span>
              <span className="file-meta">
                <span className="file-name">{card.mediaName || `large ${card.kind}`}</span>
                <span className="file-size">large {card.kind} — open in Scratch Pad to view</span>
              </span>
            </div>
          </div>
        ) : null}

        {isLink && link ? (
          <div className="media-wrap link-wrap">
            {link.embedUrl ? (
              <iframe
                className="link-embed"
                src={link.embedUrl}
                title={link.domain}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <a className="link-chip" href={link.url} target="_blank" rel="noopener noreferrer">
                <span className="link-ico">↗</span>
                <span className="link-meta">
                  <span className="link-domain">{link.domain}</span>
                  <span className="link-url">{link.url}</span>
                </span>
              </a>
            )}
          </div>
        ) : null}

        {card.kind === "text" ? (
          <div className="card-text-view flex-1 w-full text-[15px] leading-[27px] pt-[27px] pl-[60px] pr-6">
            {card.text || ""}
          </div>
        ) : card.text && (isMedia || isLink || isChunked) ? (
          <div className="caption">{card.text}</div>
        ) : null}

        <Link className="share-made" href="/">
          made with Scratch Pad
        </Link>
      </div>
    </div>
  );
}
