"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CardView, { type Card } from "./components/CardView";
import Connect from "./components/Connect";
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

function readLocalUpdatedAt(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { updatedAt?: number };
      return typeof p.updatedAt === "number" ? p.updatedAt : 0;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

// Merge a saved/remote cards array onto the fixed layout, keeping ids stable
// and migrating older link cards that stored the URL in `text`.
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
      mediaName: hit.mediaName,
      mediaType: hit.mediaType,
      mediaSize: hit.mediaSize,
    };
  });
}

type SyncStatus = "local" | "offline" | "syncing" | "synced";

export default function Home() {
  const [cards, setCards] = useState<Card[]>(DEFAULT_CARDS);
  const [hydrated, setHydrated] = useState(false);
  const cardsRef = useRef<Card[]>(cards);

  // Sync-related state
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const lastSyncedRef = useRef<string>(""); // JSON of cards last pushed/received
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // ── Restore this device's board once, on mount ──────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { cards?: Partial<Card>[] };
        if (parsed?.cards?.length) {
          setCards((prev) => mergeCards(prev, parsed.cards!));
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

  // Push the current board to the cloud (last-write-wins on updated_at).
  const pushRemote = useCallback(async () => {
    const sb = supabase;
    const uid = userIdRef.current;
    if (!sb || !uid) return;
    const snapshot = cardsRef.current;
    lastSyncedRef.current = JSON.stringify(snapshot);
    setPushing(true);
    try {
      await sb.from("buffers").upsert({
        user_id: uid,
        content: JSON.stringify({ cards: snapshot, updatedAt: Date.now() }),
        updated_at: new Date().toISOString(),
      });
    } catch {
      /* stay silent — the local copy is always safe */
    }
    setPushing(false);
  }, []);

  // Apply a board that arrived from the cloud (another device, or first load).
  const applyRemote = useCallback((content: string) => {
    try {
      const parsed = JSON.parse(content) as { cards?: Partial<Card>[] };
      if (!parsed?.cards?.length) return;
      const merged = mergeCards(cardsRef.current, parsed.cards);
      lastSyncedRef.current = JSON.stringify(merged);
      setCards(merged);
    } catch {
      /* ignore malformed remote content */
    }
  }, []);

  // ── When signed in: reconcile once, then subscribe to live changes ──
  useEffect(() => {
    const sb = supabase;
    if (!sb || !hydrated || !userEmail) return;
    const uid = userIdRef.current;
    if (!uid) return;

    let cancelled = false;
    let channel: ReturnType<typeof sb.channel> | null = null;

    (async () => {
      try {
        const { data } = await sb
          .from("buffers")
          .select("content, updated_at")
          .eq("user_id", uid)
          .maybeSingle();
        if (cancelled) return;
        if (data?.content) {
          const remoteTime = Date.parse(data.updated_at);
          if (remoteTime >= readLocalUpdatedAt()) applyRemote(data.content);
          else await pushRemote(); // local is newer → upload it
        } else {
          await pushRemote(); // no cloud copy yet → seed it
        }
      } catch {
        /* offline or not set up yet — local still works */
      }

      if (cancelled) return;
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
    })();

    return () => {
      cancelled = true;
      if (channel) sb.removeChannel(channel);
    };
  }, [userEmail, hydrated, applyRemote, pushRemote]);

  // ── Persist on every change: instant local + debounced remote ───────
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ cards, updatedAt: Date.now() })
      );
    } catch {
      /* storage unavailable */
    }
    if (supabase && userEmail && online) {
      if (JSON.stringify(cards) !== lastSyncedRef.current) {
        if (pushTimer.current) clearTimeout(pushTimer.current);
        pushTimer.current = setTimeout(() => pushRemote(), 400);
      }
    }
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [cards, hydrated, userEmail, online, pushRemote]);

  const onText = useCallback((id: string, text: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  const onTextTop = useCallback((id: string, text: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, textTop: text } : c)));
  }, []);

  const onAttach = useCallback(async (id: string, file: File) => {
    const prevCard = cardsRef.current.find((c) => c.id === id);
    const key = newKey();
    try {
      await idbPut(key, file);
    } catch {
      /* if storing fails the card still updates; it just won't render */
    }
    if (prevCard?.mediaKey && prevCard.mediaKey !== key) {
      idbDel(prevCard.mediaKey).catch(() => {});
    }
    const isImage = file.type.startsWith("image/");
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              kind: isImage ? "image" : "file",
              mediaKey: key,
              mediaName: file.name,
              mediaType: file.type,
              mediaSize: file.size,
            }
          : c
      )
    );
  }, []);

  const onLink = useCallback((id: string, url: string) => {
    const prevCard = cardsRef.current.find((c) => c.id === id);
    if (prevCard?.mediaKey) idbDel(prevCard.mediaKey).catch(() => {});
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              kind: "link",
              linkUrl: url,
              mediaKey: undefined,
              mediaName: undefined,
              mediaType: undefined,
              mediaSize: undefined,
            }
          : c
      )
    );
  }, []);

  const onClear = useCallback((id: string) => {
    const prevCard = cardsRef.current.find((c) => c.id === id);
    if (prevCard?.mediaKey) idbDel(prevCard.mediaKey).catch(() => {});
    const recovered = [prevCard?.textTop?.trim(), prevCard?.text?.trim(), prevCard?.linkUrl]
      .filter(Boolean)
      .join("\n");
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              kind: "text",
              text: recovered,
              textTop: undefined,
              linkUrl: undefined,
              mediaKey: undefined,
              mediaName: undefined,
              mediaType: undefined,
              mediaSize: undefined,
            }
          : c
      )
    );
  }, []);

  async function signOut() {
    try {
      await supabase?.auth.signOut();
    } catch {
      /* ignore */
    }
  }

  // Derive the status light from sign-in + connectivity + activity.
  let status: SyncStatus = "local";
  if (userEmail) status = !online ? "offline" : pushing ? "syncing" : "synced";
  const statusLabel = status.toUpperCase();
  const dotClass =
    status === "syncing"
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
        <span className="text-xs font-bold tracking-[0.35em]">SCRATCH</span>
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
            autoFocus
            className="sm:col-span-2 sm:row-span-3"
            onText={onText}
            onTextTop={onTextTop}
            onAttach={onAttach}
            onLink={onLink}
            onClear={onClear}
          />
          {smalls.map((c) => (
            <CardView
              key={c.id}
              card={c}
              tilt={TILT[c.id] ?? { card: 0, stamp: -4 }}
              className="sm:col-span-1"
              onText={onText}
              onTextTop={onTextTop}
              onAttach={onAttach}
              onLink={onLink}
              onClear={onClear}
            />
          ))}
        </div>
      </main>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <footer className="flex-none flex items-center justify-between px-6 py-4 border-t border-black/25 text-manila">
        <button className="scratch-btn">[DICTATE]</button>
        <button className="scratch-btn">[SHARE]</button>
      </footer>

      {showConnect && <Connect onClose={() => setShowConnect(false)} />}
    </div>
  );
}
