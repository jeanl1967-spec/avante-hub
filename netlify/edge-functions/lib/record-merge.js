// Shared by hook-image.js and hook-share-content.js: re-reads a hook's
// record fresh and writes back only the given fields merged into it,
// instead of overwriting the whole record with a possibly-stale in-memory
// copy read earlier in the same request. Any field set to `undefined` in
// `fields` is dropped from the stored record entirely — JSON.stringify
// (which store.setJSON uses internally) omits undefined-valued keys — so
// this doubles as a way to *clear* a field without needing a separate
// delete path.
//
// Matters here specifically because these endpoints can hold a record in
// memory across an earlier network call (an image download/hash, or — in
// hook-share-content.js's case — a multi-second AI call) before writing it
// back; something else can write to the same record in that window (a
// concurrent upload, or a caption/booking save), and a naive whole-object
// write-back would silently revert that other write. Best-effort, like
// every other record write in these files — the caller's own response to
// its own caller never depends on this write succeeding.
//
// Lives in netlify/edge-functions/lib/ (not directly in edge-functions/) so
// Netlify doesn't try to auto-register it as its own routed function — same
// reason every other file in here does too.
export async function mergeIntoRecord(store, key, fields) {
  try {
    const fresh = (await store.get(key, { type: "json" })) || {};
    await store.setJSON(key, { ...fresh, ...fields });
  } catch (e) {
    // best-effort
  }
}

// The fields hook-share-content.js caches after a successful AI scan.
// Shared here so every place that needs to clear them — hook-image.js's
// DELETE, admin-api.js's saveHookPhotos when Auto-build replaces the
// cover — does so identically via `mergeIntoRecord(store, key, {
// ...AI_SCAN_CACHE_FIELDS_CLEARED, ...otherFields })`, rather than each
// keeping its own copy of this field list that could quietly drift out of
// sync with whatever hook-share-content.js actually writes (add a field
// there later, and only one of two clear-sites might remember to clear
// it too). Deliberately excludes imageHash — callers that clear this
// (an image was deleted) and callers that instead set it fresh (a cover
// was replaced) need different handling for that one field, so it stays
// their own responsibility.
export const AI_SCAN_CACHE_FIELDS_CLEARED = {
  aiCaption: undefined,
  aiHashtags: undefined,
  aiImageHash: undefined,
  aiGeneratedAt: undefined,
};
