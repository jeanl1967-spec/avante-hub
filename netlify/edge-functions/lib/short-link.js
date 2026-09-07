// Shared with hook-api.js (resolving an admin-set booking link before
// personalizing it) and admin-api.js (auditing/fixing hooks whose booking
// and landing links got collapsed into the same short link — see
// fixCollapsedHookLinks). Kept here so both can't drift on what counts as
// "one of our own short links" or how one gets resolved.

// Host used by the link shortener (go-redirect.js / shorten-api.js).
export const SHORT_LINK_HOST = "go.avantetravel.co.za";

export function isShortLink(rawUrl) {
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl).hostname === SHORT_LINK_HOST;
  } catch (e) {
    return false;
  }
}

// Resolves one of our own go.avantetravel.co.za short links back to its
// original long URL via the short-links store. Falls back to the original
// URL untouched if it isn't one of ours, has no matching record, or the
// lookup fails — callers can detect "didn't resolve to anything new" by
// comparing the result back to rawUrl.
export async function resolveShortLink(rawUrl, shortLinksStore) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname !== SHORT_LINK_HOST) return rawUrl;
    const slug = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!slug) return rawUrl;
    const record = await shortLinksStore.get(slug, { type: "json" });
    return record && record.url ? record.url : rawUrl;
  } catch (e) {
    return rawUrl;
  }
}
