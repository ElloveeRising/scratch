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

// ── Sync model: recency only, with NO cross-device clocks ────────────────
// Device clocks disagree, so comparing timestamps between a phone and a laptop
// is unreliable (it caused photos to lose to older text, deletes to be ignored,
// etc.). Instead, each device remembers the last board it agreed on with the
// cloud — the "base". When a board arrives, we ask one question per card:
//
//   Did the OTHER side change this card since we last agreed (remote ≠ base)?
//     • yes → take theirs   (their action is the most recent — photo, edit, or erase)
//     • no  → keep ours     (we're the only one who touched it, if anyone)
//
// That single rule gives true recency on both ends, makes deletes propagate,
// and ignores our own echoes (an echo equals base, so "no change" → keep ours).
// A card's "did it change" identity (see `sig`) ignores device-local fields so
// the same media is never mistaken for a change across devices.

// Content signature of a card — the fields that actually sync. Excludes
// `mediaKey` (a per-device IndexedDB id), so identical media on two devices
// reads as unchanged.
function sig(c?: Partial<Card>): string {
  if (!c) return "∅";
  return JSON.stringify([
    c.kind ?? "text",
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

function boardSig(cards: Partial<Card>[]): string {
  return cards.map((c) => `${c.id}:${sig(c)}`).join("|");
}

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

// Build a card from a remote one. We deliberately DROP `mediaKey` (it points at
// the other device's IndexedDB, which we don't have) so this device loads the
// media from the shared cloud URL instead.
function cardFromRemote(base: Card, r: Partial<Card>): Card {
  const kind = r.kind ?? "text";
  let text = r.text ?? "";
  let linkUrl = r.linkUrl;
  if (kind === "link" && !linkUrl) {
    linkUrl = text;
    text = "";
  }
  return {
    ...base,
    kind,
    text,
    textTop: r.textTop,
    linkUrl,
    mediaKey: undefined,
    mediaUrl: r.mediaUrl,
    mediaPath: r.mediaPath,
    mediaName: r.mediaName,
    mediaType: r.mediaType,
    mediaSize: r.mediaSize,
  };
}

// Per-card recency merge (see note above): for each card, if the remote differs
// from our agreed base, the other device changed it → take theirs; otherwise we
// keep ours. No timestamps anywhere.
function mergeRemote(base: Card[], local: Card[], remote: Partial<Card>[]): Card[] {
  return local.map((lc) => {
    const rc = remote.find((r) => r.id === lc.id);
    if (!rc) return lc;
    const baseSig = sig(base.find((b) => b.id === lc.id));
    const remoteChanged = sig(rc) !== baseSig;
    return remoteChanged ? cardFromRemote(lc, rc) : lc;
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
  // The last board we agreed on with the cloud (pushed or received). This is the
  // anchor for the recency merge above — NOT a timestamp.
  const baseRef = useRef<Card[]>(DEFAULT_CARDS);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Write the current board + base to this device's local storage.
  const persistNow = useCallback(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ cards: cardsRef.current, base: baseRef.current })
      );
    } catch {
      /* storage unavailable */
    }
  }, []);

  // ── Restore this device's board once, on mount ──────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          cards?: Partial<Card>[];
          base?: Partial<Card>[];
        };
        if (parsed?.cards?.length) {
          const restored = mergeCards(DEFAULT_CARDS, parsed.cards);
          cardsRef.current = restored;
          setCards(restored);
        }
        // If we have a saved base, this device has synced before — trust it.
        // If not (first run, maybe used offline), use an EMPTY base so our local
        // content counts as "ours" and won't be wiped by an empty cloud.
        baseRef.current = parsed.base?.length
          ? mergeCards(DEFAULT_CARDS, parsed.base)
          : DEFAULT_CARDS;
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

  // Push the current board to the cloud. After it lands, the cloud and this
  // device agree → the snapshot becomes our new base.
  const pushRemote = useCallback(async () => {
    const sb = supabase;
    const uid = userIdRef.current;
    if (!sb || !uid) return;
    const snapshot = cardsRef.current;
    setPushing(true);
    try {
      await sb.from("buffers").upsert({
        user_id: uid,
        content: JSON.stringify({ cards: snapshot }),
        updated_at: new Date().toISOString(),
      });
      baseRef.current = snapshot;
      persistNow();
    } catch {
      /* stay silent — the local copy is always safe */
    }
    setPushing(false);
  }, [persistNow]);

  // Apply a board that arrived from the cloud (another device, or first load).
  const applyRemote = useCallback((content: string) => {
    try {
      const inc = JSON.parse(content) as { cards?: Partial<Card>[] };
      const remoteCards = inc.cards ?? [];
      if (!remoteCards.length) return;
      const remoteBoard = mergeCards(DEFAULT_CARDS, remoteCards);
      // Nothing changed remotely since we last agreed (this is our own echo, or
      // a stale repeat) → ignore it so in-progress edits are never reverted.
      if (boardSig(remoteBoard) === boardSig(baseRef.current)) return;
      const merged = mergeRemote(baseRef.current, cardsRef.current, remoteCards);
      baseRef.current = remoteBoard;
      cardsRef.current = merged;
      setCards(merged);
      // If we kept any local edits the cloud hasn't seen, the persist effect
      // below will notice (board ≠ base) and push them.
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
          .select("content")
          .eq("user_id", uid)
          .maybeSingle();
        if (cancelled) return;
        if (data?.content) {
          let remoteCards: Partial<Card>[] = [];
          try {
            remoteCards =
              (JSON.parse(data.content) as { cards?: Partial<Card>[] }).cards ?? [];
          } catch {
            /* ignore malformed remote */
          }
          if (remoteCards.length) {
            const merged = mergeRemote(baseRef.current, cardsRef.current, remoteCards);
            baseRef.current = mergeCards(DEFAULT_CARDS, remoteCards);
            cardsRef.current = merged;
            setCards(merged);
          }
        }
        // Always upload the result so the cloud holds the merged union and our
        // base matches what we just pushed.
        await pushRemote();
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
    persistNow();
    if (supabase && userEmail && online) {
      // Push only when our board differs from what the cloud last agreed on.
      if (boardSig(cards) !== boardSig(baseRef.current)) {
        if (pushTimer.current) clearTimeout(pushTimer.current);
        pushTimer.current = setTimeout(() => pushRemote(), 400);
      }
    }
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [cards, hydrated, userEmail, online, pushRemote, persistNow]);

  const onText = useCallback((id: string, text: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));
  }, []);

  const onTextTop = useCallback((id: string, text: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, textTop: text } : c)));
  }, []);

  const onAttach = useCallback(async (id: string, file: File) => {
    const prevCard = cardsRef.current.find((c) => c.id === id);
    const key = newKey();
    setPushing(true);
    try {
      await idbPut(key, file); // fast local copy
    } catch {
      /* local store failed; the cloud upload below may still succeed */
    }
    if (prevCard?.mediaKey && prevCard.mediaKey !== key) {
      idbDel(prevCard.mediaKey).catch(() => {});
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const kind: "image" | "video" | "file" = isImage ? "image" : isVideo ? "video" : "file";

    // Upload the actual file to cloud storage so OTHER devices can load it.
    let mediaUrl: string | undefined;
    let mediaPath: string | undefined;
    const sb = supabase;
    const uid = userIdRef.current;
    if (sb && uid) {
      try {
        const ext =
          (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
        const path = `${uid}/${key}.${ext}`;
        const { error } = await sb.storage
          .from("media")
          .upload(path, file, {
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
    if (prevCard?.mediaPath && prevCard.mediaPath !== mediaPath && sb) {
      sb.storage.from("media").remove([prevCard.mediaPath]).catch(() => {});
    }

    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              kind,
              mediaKey: key,
              mediaUrl,
              mediaPath,
              mediaName: file.name,
              mediaType: file.type,
              mediaSize: file.size,
            }
          : c
      )
    );
    setPushing(false);
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

  // Erase a whole card (text + media + cloud copy). Triggered with a confirm.
  const onWipe = useCallback((id: string) => {
    const prevCard = cardsRef.current.find((c) => c.id === id);
    if (prevCard?.mediaKey) idbDel(prevCard.mediaKey).catch(() => {});
    if (prevCard?.mediaPath && supabase) {
      supabase.storage.from("media").remove([prevCard.mediaPath]).catch(() => {});
    }
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
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
            onWipe={onWipe}
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
              onWipe={onWipe}
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
