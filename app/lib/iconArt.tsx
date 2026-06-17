// Shared artwork for every app icon (favicon, Apple touch icon, manifest
// icons). A cream index card with an "SP" monogram on dark walnut — the same
// palette as the app. Rendered to PNG at various sizes via next/og ImageResponse.
// Uses only inline styles (the Satori subset) and a single flex child per node.
export function iconArt(size: number) {
  return (
    <div
      style={{
        height: size,
        width: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#6e4c2c",
      }}
    >
      <div
        style={{
          height: size * 0.74,
          width: size * 0.74,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ecdca6",
          borderRadius: size * 0.14,
          border: `${Math.max(2, size * 0.02)}px solid #2c1e0e`,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: size * 0.4,
            fontWeight: 800,
            color: "#1c1b1a",
          }}
        >
          SP
        </div>
      </div>
    </div>
  );
}
