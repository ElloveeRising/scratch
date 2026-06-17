"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardView, { type Card } from "./components/CardView";
import Connect from "./components/Connect";
import ShareModal from "./components/ShareModal";
import { idbDel, idbPut } from "./lib/idb";
import { supabase } from "./lib/supabase";

const STORAGE_KEY = "scratch:board:v1";

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

// Supabase free tier rejects single uploads over 50MB. Anything bigger skips the
// (doomed) cloud upload and stays on-device only, so attaching never hangs.
const MAX_SYNC_BYTES = 50 * 1024 * 1024;

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
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

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

  // Upload a file to cloud storage (+ keep a fast local copy) and return the
  // media fields for the card draft. Does NOT touch the board — the draft only
  // becomes real when the user hits Save.
  const onUpload = useCallback(async (file: File): Promise<Partial<Card>> => {
    const key = newKey();
    try {
      await idbPut(key, file);
    } catch {
      /* local store failed; the cloud copy below may still succeed */
    }
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const kind: "image" | "video" | "file" = isImage ? "image" : isVideo ? "video" : "file";

    let mediaUrl: string | undefined;
    let mediaPath: string | undefined;
    const sb = supabase;
    const uid = userIdRef.current;
    if (sb && uid && file.size <= MAX_SYNC_BYTES) {
      try {
        const ext =
          (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
        const path = `${uid}/${key}.${ext}`;
        const { error } = await sb.storage.from("media").upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });
        if (!error) {
          mediaPath = path;
          mediaUrl = sb.storage.from("media").getPublicUrl(path).data.publicUrl;
        }
      } catch {
        /* upload failed — media stays available on this device only */
      }
    }
    return {
      kind,
      mediaKey: key,
      mediaUrl,
      mediaPath,
      mediaName: file.name,
      mediaType: file.type,
      mediaSize: file.size,
    };
  }, []);

  // Commit one card's draft. This is the ONLY thing that writes to the cloud.
  // We re-read the freshest cloud board first so saving one card never clobbers
  // another card with stale data, then write our card on top. Last save wins.
  const onSave = useCallback(
    async (id: string, fields: Partial<Card>) => {
      const layout = DEFAULT_CARDS.find((d) => d.id === id) ?? DEFAULT_CARDS[0];
      const commit = (board: Card[]) =>
        board.map((c) => (c.id === id ? { ...layout, ...c, ...fields } : c));

      // Clean up media we're replacing or removing (best-effort).
      const prev = cardsRef.current.find((c) => c.id === id);
      if (prev?.mediaPath && prev.mediaPath !== fields.mediaPath && supabase) {
        supabase.storage.from("media").remove([prev.mediaPath]).catch(() => {});
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
        <span className="text-xs font-bold tracking-[0.35em]">SCRATCH PAD</span>
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
      <main className="flex-1 overflow-hidden p-4 sm:p-6">
        <div className="h-full grid gap-4 grid-cols-1 grid-rows-[2fr_1fr_1fr_1fr] sm:grid-cols-3 sm:grid-rows-3">
          <CardView
            card={big}
            tilt={TILT[big.id] ?? { card: 0, stamp: -4 }}
            className="sm:col-span-2 sm:row-span-3"
            onSave={onSave}
            onUpload={onUpload}
            onShare={() => setSharing(true)}
          />
          {smalls.map((c) => (
            <CardView
              key={c.id}
              card={c}
              tilt={TILT[c.id] ?? { card: 0, stamp: -4 }}
              className="sm:col-span-1"
              onSave={onSave}
              onUpload={onUpload}
            />
          ))}
        </div>
      </main>

      {showConnect && <Connect onClose={() => setShowConnect(false)} />}
      {sharing && <ShareModal card={big} onClose={() => setSharing(false)} />}
    </div>
  );
}
