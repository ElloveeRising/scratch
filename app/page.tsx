"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardView, { type Card } from "./components/CardView";
import Connect from "./components/Connect";
import ShareModal from "./components/ShareModal";
import LoadingOverlay from "./components/LoadingOverlay";
import { idbDel, idbPut } from "./lib/idb";
import { supabase } from "./lib/supabase";

const STORAGE_KEY = "scratch:board:v1";

// Bump on each deploy during this phase — shown in the header so you can tell
// whether the device loaded the latest build (vs a cached one). The width
// readout next to it reports the browser's CSS viewport width (diagnostic).
const VERSION = "0.7";

// Fixed board: one big "main" card plus three small cards.
const DEFAULT_CARDS: Card[] = [
  { id: "main", label: "MAIN", size: "big", kind: "text", text: "" },
  { id: "c1", label: "01", size: "small", kind: "text", text: "" },
  { id: "c2", label: "02", size: "small", kind: "text", text: "" },
  { id: "c3", label: "03", size: "small", kind: "text", text: "" },
];

// Deterministic "hand-placed" tilts (degrees) so SSR and client match.
const TILT: Record<string, { card: number; stamp: number }> = {
  main: { card: -0.3, stamp: -3 },
  c1: { card: 0.7, stamp: 3 },
  c2: { card: -0.6, stamp: -5 },
  c3: { card: 0.5, stamp: 2 },
};

function newKey(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `m-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

// Supabase free tier rejects single uploads over 50MB — so big media is split
// into sub-cap chunks and reassembled on the other device (full quality, free).
const MAX_SYNC_BYTES = 50 * 1024 * 1024; // free per-file cap
const CHUNK_BYTES = 45 * 1024 * 1024; // size of each chunk (safely under the cap)
const CHUNK_CEILING = 500 * 1024 * 1024; // beyond this, keep on-device only (free total ~1GB)
const IMG_COMPRESS_OVER = 5 * 1024 * 1024; // re-encode images larger than this
const IMG_MAX_DIM = 3200; // longest side (px) after downscale

// Downscale + re-encode a large image to WebP at high quality (near-lossless to
// the eye) so it uploads fast and sips storage. Returns null to keep the original.
async function compressImage(file: File): Promise<{ blob: Blob; type: string } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const longest = Math.max(bmp.width, bmp.height);
    const scale = longest > IMG_MAX_DIM ? IMG_MAX_DIM / longest : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/webp", 0.85)
    );
    if (blob && blob.size < file.size) return { blob, type: "image/webp" };
    return null;
  } catch {
    return null;
  }
}

// ── Sync model: explicit save, single writer at a time ──────────────────
// The old continuous merge fought itself: every keystroke and even just
// OPENING the app made a device write its whole board to the cloud, so an open
// laptop constantly steamrolled the phone. The fix is to make writes
// intentional: a card is edited as a private DRAFT (in CardView) and only the
// SAVE button writes to the cloud. A device that's merely viewing never writes,
// so it can't override anything; whatever you SAVE last wins, cleanly.
//
// Reads are simple and robust: pull the cloud on load and whenever the app
// regains focus, plus a live realtime subscription. There's no per-card merge
// to get wrong — view cards just reflect the cloud; the card you're editing is
// shielded by its local draft until you commit it.

// Lay a saved/remote cards array onto the fixed layout, keeping ids stable and
// migrating older link cards that stored the URL in `text`.
function mergeCards(base: Card[], saved: Partial<Card>[]): Card[] {
  return base.map((c) => {
    const hit = saved.find((s) => s.id === c.id);
    if (!hit) return c;
    const kind = hit.kind ?? "text";
    let text = hit.text ?? "";
    let linkUrl = hit.linkUrl;
    if (kind === "link" && !linkUrl) {
      linkUrl = text;
      text = "";
    }
    return {
      ...c,
      kind,
      text,
      textTop: hit.textTop,
      linkUrl,
      mediaKey: hit.mediaKey,
      mediaUrl: hit.mediaUrl,
      mediaPath: hit.mediaPath,
      mediaName: hit.mediaName,
      mediaType: hit.mediaType,
      mediaSize: hit.mediaSize,
      mediaChunks: hit.mediaChunks,
    };
  });
}

type SyncStatus = "local" | "offline" | "saving" | "synced";

export default function Home() {
  const [cards, setCards] = useState<Card[]>(DEFAULT_CARDS);
  const [hydrated, setHydrated] = useState(false);
  const cardsRef = useRef<Card[]>(cards);

  // Sync-related state
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [upload, setUpload] = useState<{ active: boolean; msg: string; fraction: number | null }>({
    active: false,
    msg: "",
    fraction: null,
  });
  const [vw, setVw] = useState(0); // CSS viewport width — shown in header for diagnostics
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Track the CSS viewport width (diagnostic readout in the header).
  useEffect(() => {
    const upd = () => setVw(window.innerWidth);
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  // Write the current board to this device's local storage (instant + offline).
  const persistNow = useCallback((board?: Card[]) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ cards: board ?? cardsRef.current })
      );
    } catch {
      /* storage unavailable */
    }
  }, []);

  const applyBoard = useCallback(
    (board: Card[]) => {
      cardsRef.current = board;
      setCards(board);
      persistNow(board);
    },
    [persistNow]
  );

  // ── Restore this device's board once, on mount ──────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { cards?: Partial<Card>[] };
        if (parsed?.cards?.length) {
          const restored = mergeCards(DEFAULT_CARDS, parsed.cards);
          cardsRef.current = restored;
          setCards(restored);
        }
      }
    } catch {
      /* ignore unreadable data */
    }
    setHydrated(true);
  }, []);

  // ── Online / offline awareness ──────────────────────────────────────
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // ── Track the signed-in user ────────────────────────────────────────
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      userIdRef.current = data.session?.user?.id ?? null;
      setUserEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      userIdRef.current = session?.user?.id ?? null;
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Pull the latest board from the cloud (read-only — never writes, except to
  // seed an empty cloud the very first time).
  const pullRemote = useCallback(async () => {
    const sb = supabase;
    const uid = userIdRef.current;
    if (!sb || !uid) return;
    try {
      const { data } = await sb
        .from("buffers")
        .select("content")
        .eq("user_id", uid)
        .maybeSingle();
      if (data?.content) {
        let cloudCards: Partial<Card>[] = [];
        try {
          cloudCards =
            (JSON.parse(data.content) as { cards?: Partial<Card>[] }).cards ?? [];
        } catch {
          /* ignore malformed remote */
        }
        if (cloudCards.length) applyBoard(mergeCards(DEFAULT_CARDS, cloudCards));
      } else {
        // No cloud row yet → seed it once with whatever this device has.
        await sb.from("buffers").upsert({
          user_id: uid,
          content: JSON.stringify({ cards: cardsRef.current }),
          updated_at: new Date().toISOString(),
        });
      }
    } catch {
      /* offline or not set up — local copy still works */
    }
  }, [applyBoard]);

  // Apply a board pushed by another device (realtime).
  const applyRemote = useCallback(
    (content: string) => {
      try {
        const cloudCards =
          (JSON.parse(content) as { cards?: Partial<Card>[] }).cards ?? [];
        if (!cloudCards.length) return;
        applyBoard(mergeCards(DEFAULT_CARDS, cloudCards));
      } catch {
        /* ignore malformed remote content */
      }
    },
    [applyBoard]
  );

  // ── When signed in: pull once, then subscribe to live changes ───────
  useEffect(() => {
    const sb = supabase;
    if (!sb || !hydrated || !userEmail) return;
    const uid = userIdRef.current;
    if (!uid) return;

    let channel: ReturnType<typeof sb.channel> | null = null;
    pullRemote();
    channel = sb
      .channel(`buffers-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "buffers", filter: `user_id=eq.${uid}` },
        (payload) => {
          const row = payload.new as { content?: string } | null;
          if (row?.content) applyRemote(row.content);
        }
      )
      .subscribe();

    return () => {
      if (channel) sb.removeChannel(channel);
    };
  }, [userEmail, hydrated, pullRemote, applyRemote]);

  // ── Refresh from the cloud whenever the app comes back into view ────
  // (covers any realtime event missed while the tab/app was backgrounded).
  useEffect(() => {
    if (!userEmail) return;
    const refresh = () => {
      if (document.visibilityState === "visible") pullRemote();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [userEmail, pullRemote]);

  // Upload a file and return the media fields for the card draft. Compresses
  // large images; splits anything still over the per-file cap into sub-cap
  // chunks (reassembled on the other device, full quality). Keeps a fast local
  // copy. Does NOT touch the board — the draft only becomes real on Save.
  // Heavy files drive the library loading overlay; `onProgress` also feeds the
  // card's own little status line.
  const onUpload = useCallback(
    async (file: File, onProgress?: (msg: string) => void): Promise<Partial<Card>> => {
      const startedAt = Date.now();
      const report = (msg: string, fraction: number | null = null) => {
        onProgress?.(msg);
        setUpload({ active: true, msg, fraction });
      };
      setUpload({ active: true, msg: "preparing…", fraction: null });
      try {
        const key = newKey();
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        const kind: "image" | "video" | "file" = isImage ? "image" : isVideo ? "video" : "file";

        // 1. Compress large images (near-lossless) before storing/uploading.
        let blob: Blob = file;
        let mediaType = file.type || "application/octet-stream";
        if (isImage && file.size > IMG_COMPRESS_OVER) {
          report("optimizing image…");
          const c = await compressImage(file);
          if (c) {
            blob = c.blob;
            mediaType = c.type;
          }
        }

        // 2. Keep a fast local copy on THIS device.
        try {
          await idbPut(key, blob);
        } catch {
          /* local store failed; the cloud copy below may still succeed */
        }

        const base: Partial<Card> = {
          kind,
          mediaKey: key,
          mediaName: file.name,
          mediaType,
          mediaSize: blob.size,
        };

        const sb = supabase;
        const uid = userIdRef.current;
        if (!sb || !uid) return base; // signed out → local only

        // 3a. Fits in one piece → single upload (the common case).
        if (blob.size <= MAX_SYNC_BYTES) {
          try {
            report("uploading…");
            const ext =
              (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
            const path = `${uid}/${key}.${ext}`;
            const { error } = await sb.storage
              .from("media")
              .upload(path, blob, { contentType: mediaType, upsert: true });
            if (!error) {
              return {
                ...base,
                mediaPath: path,
                mediaUrl: sb.storage.from("media").getPublicUrl(path).data.publicUrl,
              };
            }
          } catch {
            /* fall through to local-only */
          }
          return base;
        }

        // 3b. Over the cap but within reason → split into sub-cap chunks.
        if (blob.size <= CHUNK_CEILING) {
          try {
            const count = Math.ceil(blob.size / CHUNK_BYTES);
            const chunkBase = `${uid}/${key}`;
            for (let i = 0; i < count; i++) {
              report(`uploading ${i + 1}/${count}…`, i / count);
              const part = blob.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
              const { error } = await sb.storage
                .from("media")
                .upload(`${chunkBase}.part${i}`, part, {
                  contentType: "application/octet-stream",
                  upsert: true,
                });
              if (error) throw error;
            }
            report("almost done…", 1);
            return { ...base, mediaPath: chunkBase, mediaChunks: count };
          } catch {
            /* a chunk failed — keep on-device only */
          }
          return base;
        }

        // 3c. Beyond what the free tier can hold — keep on this device only.
        return base;
      } finally {
        // Keep the librarian on screen for at least a beat so quick uploads
        // (small photos, files) don't flash — Otto gets his moment for anything.
        const remaining = Math.max(0, 650 - (Date.now() - startedAt));
        const clear = () => setUpload({ active: false, msg: "", fraction: null });
        if (remaining === 0) clear();
        else setTimeout(clear, remaining);
      }
    },
    []
  );

  // Commit one card's draft. This is the ONLY thing that writes to the cloud.
  // We re-read the freshest cloud board first so saving one card never clobbers
  // another card with stale data, then write our card on top. Last save wins.
  const onSave = useCallback(
    async (id: string, fields: Partial<Card>) => {
      const layout = DEFAULT_CARDS.find((d) => d.id === id) ?? DEFAULT_CARDS[0];
      const commit = (board: Card[]) =>
        board.map((c) => (c.id === id ? { ...layout, ...c, ...fields } : c));

      // Clean up media we're replacing or removing (best-effort; chunked media
      // leaves N part objects, so remove them all).
      const prev = cardsRef.current.find((c) => c.id === id);
      if (prev?.mediaPath && prev.mediaPath !== fields.mediaPath && supabase) {
        const prevChunks = prev.mediaChunks ?? 0;
        const paths =
          prevChunks > 1
            ? Array.from({ length: prevChunks }, (_, i) => `${prev.mediaPath}.part${i}`)
            : [prev.mediaPath];
        supabase.storage.from("media").remove(paths).catch(() => {});
      }
      if (prev?.mediaKey && prev.mediaKey !== fields.mediaKey) {
        idbDel(prev.mediaKey).catch(() => {});
      }

      // Optimistic local update so the card updates instantly.
      applyBoard(commit(cardsRef.current));

      const sb = supabase;
      const uid = userIdRef.current;
      if (!sb || !uid) return; // signed out → local only
      setSaving(true);
      try {
        const { data } = await sb
          .from("buffers")
          .select("content")
          .eq("user_id", uid)
          .maybeSingle();
        let board = cardsRef.current;
        if (data?.content) {
          try {
            const cloudCards =
              (JSON.parse(data.content) as { cards?: Partial<Card>[] }).cards ?? [];
            if (cloudCards.length) board = commit(mergeCards(DEFAULT_CARDS, cloudCards));
          } catch {
            /* ignore malformed remote */
          }
        }
        applyBoard(board);
        await sb.from("buffers").upsert({
          user_id: uid,
          content: JSON.stringify({ cards: board }),
          updated_at: new Date().toISOString(),
        });
      } catch {
        /* push failed — local copy is safe; next save/refresh will reconcile */
      }
      setSaving(false);
    },
    [applyBoard]
  );

  async function signOut() {
    try {
      await supabase?.auth.signOut();
    } catch {
      /* ignore */
    }
  }

  // Derive the status light from sign-in + connectivity + activity.
  let status: SyncStatus = "local";
  if (userEmail) status = !online ? "offline" : saving ? "saving" : "synced";
  const statusLabel = status.toUpperCase();
  const dotClass =
    status === "saving"
      ? "bg-status-syncing"
      : status === "offline"
        ? "bg-status-offline"
        : "bg-status-synced";

  const big = cards.find((c) => c.size === "big") ?? DEFAULT_CARDS[0];
  const smalls = cards.filter((c) => c.size === "small");

  return (
    <div className="desk h-screen flex flex-col text-ink overflow-hidden">
      {/* ── Status bar ───────────────────────────────────────────────── */}
      <header className="flex-none flex items-center justify-between px-6 py-3 border-b border-black/25 text-manila">
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-bold tracking-[0.35em]">SCRATCH PAD</span>
          <span className="text-[10px] opacity-60 tracking-wider">v{VERSION} · {vw || "…"}w</span>
        </span>
        <div className="flex items-center gap-3">
          {userEmail ? (
            <>
              <span className="hdr-email" title={userEmail}>
                {userEmail}
              </span>
              <button type="button" className="hdr-btn" onClick={signOut}>
                sign out
              </button>
            </>
          ) : (
            <button type="button" className="hdr-btn" onClick={() => setShowConnect(true)}>
              connect
            </button>
          )}
          <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
          <span className="text-[10px] tracking-[0.2em]">{statusLabel}</span>
        </div>
      </header>

      {/* ── Board: one big card + three small cards ──────────────────── */}
      {/* Two-column "board": notebook (MAIN) on the left, the 3 small cards
          stacked on the right — same shape on phone and desktop. */}
      <main className="flex-1 overflow-hidden p-3 sm:p-6">
        <div className="grid h-full gap-3 sm:gap-4 grid-cols-[1.15fr_1fr] lg:grid-cols-[2fr_1fr] grid-rows-3">
          <CardView
            card={big}
            tilt={TILT[big.id] ?? { card: 0, stamp: -4 }}
            className="row-span-3 min-h-0"
            onSave={onSave}
            onUpload={onUpload}
            onShare={() => setSharing(true)}
          />
          {smalls.map((c) => (
            <CardView
              key={c.id}
              card={c}
              tilt={TILT[c.id] ?? { card: 0, stamp: -4 }}
              className="min-h-0"
              onSave={onSave}
              onUpload={onUpload}
            />
          ))}
        </div>
      </main>

      {showConnect && <Connect onClose={() => setShowConnect(false)} />}
      {sharing && <ShareModal card={big} onClose={() => setSharing(false)} />}
      {upload.active && <LoadingOverlay msg={upload.msg} fraction={upload.fraction} />}
    </div>
  );
}
