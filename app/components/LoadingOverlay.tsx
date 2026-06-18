"use client";

import { useEffect, useState } from "react";

// Library-flavored lines that cycle for personality while the real status
// (e.g. "uploading 3/12…") stays put below.
const FLAVOR = [
  "Cross-referencing the card catalog…",
  "Consulting the Dewey Decimal System…",
  "Stamping the due date…",
  "Filing under “miscellaneous”…",
  "Shushing the other patrons…",
  "Re-shelving by subject…",
  "Alphabetizing with great vigor…",
];

export default function LoadingOverlay({
  msg,
  fraction,
}: {
  msg: string;
  fraction: number | null;
}) {
  const [flavor, setFlavor] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFlavor((f) => (f + 1) % FLAVOR.length), 2600);
    return () => clearInterval(t);
  }, []);

  const pct = fraction != null ? Math.max(5, Math.min(100, Math.round(fraction * 100))) : null;

  return (
    <div className="load-overlay" role="status" aria-live="polite">
      <div className="load-card">
        <span className="card-stamp">FILING</span>

        <svg className="otto-svg" viewBox="0 0 260 172" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          {/* to-file stack (left) */}
          <g>
            <rect x="14" y="118" width="52" height="34" rx="3" fill="#ecdca6" stroke="#b9a06a" transform="rotate(-7 40 135)" />
            <rect x="18" y="113" width="52" height="34" rx="3" fill="#f3e6bf" stroke="#b9a06a" transform="rotate(-2 44 130)" />
            <rect x="15" y="108" width="52" height="34" rx="3" fill="#ecdca6" stroke="#b9a06a" transform="rotate(4 41 125)" />
          </g>

          {/* filed pile (right, chaotic) */}
          <g>
            <rect x="196" y="124" width="50" height="32" rx="3" fill="#ecdca6" stroke="#b9a06a" transform="rotate(9 221 140)" />
            <rect x="192" y="119" width="50" height="32" rx="3" fill="#f3e6bf" stroke="#b9a06a" transform="rotate(-6 217 135)" />
            <rect x="198" y="113" width="50" height="32" rx="3" fill="#ecdca6" stroke="#b9a06a" transform="rotate(15 223 129)" />
          </g>

          {/* cards being tossed across (over Otto's head) */}
          <rect className="toss toss1" width="44" height="29" rx="3" fill="#f3e6bf" stroke="#b9a06a" />
          <rect className="toss toss2" width="44" height="29" rx="3" fill="#ecdca6" stroke="#b9a06a" />
          <rect className="toss toss3" width="44" height="29" rx="3" fill="#f3e6bf" stroke="#b9a06a" />

          {/* Otto, the guest librarian */}
          <g className="otto">
            <g className="otto-arms" stroke="#8b6fc7" strokeWidth="9" fill="none" strokeLinecap="round">
              <path className="arm a1" d="M108 104 q-24 8 -28 30" />
              <path className="arm a2" d="M120 109 q-12 16 -20 34" />
              <path className="arm a3" d="M132 111 q0 20 -6 36" />
              <path className="arm a4" d="M141 109 q12 16 18 34" />
              <path className="arm a5" d="M152 104 q24 8 30 30" />
            </g>
            <ellipse cx="130" cy="66" rx="44" ry="40" fill="#8b6fc7" stroke="#3a2c52" strokeWidth="3" />
            <ellipse cx="103" cy="80" rx="7" ry="4.5" fill="#d98aa8" opacity="0.55" />
            <ellipse cx="157" cy="80" rx="7" ry="4.5" fill="#d98aa8" opacity="0.55" />
            <ellipse cx="113" cy="60" rx="12" ry="14" fill="#fff" />
            <ellipse cx="147" cy="60" rx="12" ry="14" fill="#fff" />
            <g className="otto-pupils" fill="#1c1b1a">
              <circle cx="113" cy="62" r="4.6" />
              <circle cx="147" cy="62" r="4.6" />
            </g>
            <g fill="none" stroke="#2a2030" strokeWidth="2.5">
              <circle cx="113" cy="60" r="14" />
              <circle cx="147" cy="60" r="14" />
              <path d="M127 60 H133 M99 57 L89 53 M161 57 L171 53" />
            </g>
            <path d="M122 87 q8 8 16 0" fill="none" stroke="#3a2c52" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        </svg>

        <div className="load-status">{msg || "working…"}</div>
        <div className="load-flavor">{FLAVOR[flavor]}</div>

        <div className={`load-bar ${pct == null ? "is-indeterminate" : ""}`}>
          <div
            className="load-bar-fill"
            style={pct != null ? { width: `${pct}%` } : undefined}
          />
        </div>
      </div>
    </div>
  );
}
