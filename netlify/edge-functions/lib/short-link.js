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

// Slug shape and per-affiliate index — shared by shorten-api.js's own POST
// /api/shorten handler and the two helpers below (admin-api.js's bulk
// short-code generator), so neither can drift from the other on what a
// slug looks like or how the per-affiliate index is keyed/capped.
export const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/l/I
export const RANDOM_SLUG_LEN = 6;
export const MAX_LINKS_PER_AFFILIATE = 300; // cap the per-affiliate index so it can't grow unbounded

export function randomSlug() {
  let out = "";
  for (let i = 0; i < RANDOM_SLUG_LEN; i++) {
    out += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
  }
  return out;
}

export function affIndexKey(aff) {
  return "aff:" + aff;
}

// The two functions below are used by admin-api.js's bulk short-code
// generator (generateShortCodes) — a separate, deliberately independent
// code path from shorten-api.js's own POST /api/shorten handler, which has
// its own (slightly different) custom-alias upsert semantics we don't want
// to entangle with a bulk/idempotent caller.

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
// should check findExistingShortLink() first.
//
// Netlify Blobs has no compare-and-swap, so a "check candidate is free,
// then write it" pair isn't atomic — a bulk caller running many of these
// concurrently (see admin-api.js's mapWithConcurrency) could have two
// callers both see the same candidate slug as free and both write it, with
// the second silently clobbering the first's record. Guarded against by
// re-reading immediately after the write and confirming it's still ours;
// if another writer clobbered it in between, that attempt is abandoned and
// a fresh candidate is tried instead of returning a slug that doesn't
// actually point where we think it does. Returns null only if every
// attempt collides or loses that race.
export async function createShortLink(shortLinksStore, longUrl, aff) {
  const record = { url: longUrl, aff: aff || "", createdAt: new Date().toISOString(), clicks: 0 };

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = randomSlug();
    const existing = await shortLinksStore.get(candidate, { type: "json" });
    if (existing) continue;

    await shortLinksStore.setJSON(candidate, record);

    const verify = await shortLinksStore.get(candidate, { type: "json" });
    if (!verify || verify.url !== record.url || verify.aff !== record.aff) continue; // lost the race — try another slug

    if (aff) {
      const indexKey = affIndexKey(aff);
      const existingSlugs = (await shortLinksStore.get(indexKey, { type: "json" })) || [];
      const updatedSlugs = [candidate, ...existingSlugs.filter((s) => s !== candidate)].slice(0, MAX_LINKS_PER_AFFILIATE);
      await shortLinksStore.setJSON(indexKey, updatedSlugs);
    }

    return { slug: candidate, shortUrl: "https://" + SHORT_LINK_HOST + "/" + candidate, ...record };
  }
  return null;
}
