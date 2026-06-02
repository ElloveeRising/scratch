// Detect URLs and, for known video providers, produce an embeddable URL so a
// pasted link can play inline instead of showing as plain text.

export interface LinkInfo {
  url: string;
  domain: string;
  provider: "youtube" | "vimeo" | "generic";
  embedUrl?: string;
}

const URL_ONLY = /^https?:\/\/\S+$/i;

export function isUrl(text: string): boolean {
  return URL_ONLY.test(text.trim());
}

export function parseLink(raw: string): LinkInfo {
  const url = raw.trim();

  let domain = url;
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep raw */
  }

  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i
  );
  if (yt) {
    return {
      url,
      domain,
      provider: "youtube",
      embedUrl: `https://www.youtube.com/embed/${yt[1]}`,
    };
  }

  const vm = url.match(/vimeo\.com\/(\d+)/i);
  if (vm) {
    return {
      url,
      domain,
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${vm[1]}`,
    };
  }

  return { url, domain, provider: "generic" };
}
