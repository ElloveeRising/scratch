import { ImageResponse } from "next/og";
import { iconArt } from "../../lib/iconArt";

// PNG app icons at arbitrary sizes, used by the web manifest (e.g. /icon-png/192,
// /icon-png/512). Generated on the fly so there are no binary assets to manage.
export async function GET(_req: Request, ctx: { params: Promise<{ size: string }> }) {
  const { size } = await ctx.params;
  let n = parseInt(size, 10);
  if (!Number.isFinite(n)) n = 192;
  n = Math.min(1024, Math.max(16, n));
  return new ImageResponse(iconArt(n), { width: n, height: n });
}
