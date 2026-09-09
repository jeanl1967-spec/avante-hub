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

// The two helpers below are used by admin-api.js's bulk short-code
// generator (generateShortCodes) — a separate, deliberately independent
// path from shorten-api.js's own POST /api/shorten handler, which has its
// own (slightly different) custom-alias upsert semantics we don't want to
// entangle with a bulk/idempotent caller. Kept here rather than duplicated
// inline so the slug alphabet/length and per-affiliate index shape can't
// drift from shorten-api.js's.
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/l/I
const RANDOM_SLUG_LEN = 6;
const MAX_LINKS_PER_AFFILIATE = 300; // same cap shorten-api.js enforces

function randomSlug() {
  let out = "";
  for (let i = 0; i < RANDOM_SLUG_LEN; i++) {
    out += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return out;
}

function affIndexKey(aff) {
  return "aff:" + aff;
}

// Looks for a short link this affiliate already has pointing at exactly
// longUrl, so a bulk/idempotent caller can skip creating a duplicate for
// content that hasn't changed since the last run. Returns null if none
// exists (or aff is empty).
export async function findExistingShortLink(shortLinksStore, aff, longUrl) {
  if (!aff || !longUrl) return null;
  const slugs = (await shortLinksStore.get(affIndexKey(aff), { type: "json" })) || [];
  for (const slug of slugs) {
    const record = await shortLinksStore.get(slug, { type: "json" });
    if (record && record.url === longUrl) {
      return { slug, shortUrl: "https://" + SHORT_LINK_HOST + "/" + slug, ...record };
    }
  }
  return null;
}

// Creates a brand-new random-slug short link for longUrl, tagged to aff,
// and indexes it under that affiliate (same index shorten-api.js's own GET
// ?aff= listing reads). Always creates fresh — callers wanting idempotency
// should check findExistingShortLink() first. Returns null only in the
// (extremely unlikely) case of repeated slug collisions.
export async function createShortLink(shortLinksStore, longUrl, aff) {
  let slug;
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = randomSlug();
    const existing = await shortLinksStore.get(candidate, { type: "json" });
    if (!existing) {
      slug = candidate;
      break;
    }
  }
  if (!slug) return null;

  const record = { url: longUrl, aff: aff || "", createdAt: new Date().toISOString(), clicks: 0 };
  await shortLinksStore.setJSON(slug, record);

  if (aff) {
    const indexKey = affIndexKey(aff);
    const existingSlugs = (await shortLinksStore.get(indexKey, { type: "json" })) || [];
    const updatedSlugs = [slug, ...existingSlugs.filter((s) => s !== slug)].slice(0, MAX_LINKS_PER_AFFILIATE);
    await shortLinksStore.setJSON(indexKey, updatedSlugs);
  }

  return { slug, shortUrl: "https://" + SHORT_LINK_HOST + "/" + slug, ...record };
}
