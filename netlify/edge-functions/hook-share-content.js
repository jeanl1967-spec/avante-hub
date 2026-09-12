import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";
import { draftCaptionFromImage } from "./lib/vision-caption-helper.js";
import { generateHashtags } from "./lib/hashtag-helper.js";
import { sha256Hex } from "./lib/image-hash.js";
import { mergeIntoRecord } from "./lib/record-merge.js";

// Backs the "Get Shareable Content" modal's AI scan: given a hook's own
// image, drafts a caption from what's actually on it (see
// vision-caption-helper.js) and the matching per-platform hashtag set (see
// hashtag-helper.js), so the modal can offer something better than
// whatever caption happens to be typed into the hook's own Caption field.
//
// Unauthenticated, same as hook-image.js and hook-pdf.js — this only ever
// reads a hook's own (already-public-once-posted) image and writes back a
// caption/hashtag cache for that same hook, keyed the identical
// "aff:hook" way (aff === "__admin__" for admin's default hooks, a real
// affiliate id otherwise). No new attack surface beyond what those two
// endpoints already accept.
//
// Caching: the scan is expensive (an LLM vision call) and the modal can be
// opened many times for the same unchanged image, so the result is cached
// on the hook's own record (in the shared "promo-hooks" store) alongside
// the image hash it was generated from. A later request only re-scans when
// that hash no longer matches the hook's current image (i.e. the image was
// replaced) or the caller explicitly asks for one via ?force=1 (the
// modal's "Regenerate" button).
export default async (request, context) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, cors);
  }

  const url = new URL(request.url);
  const aff = (url.searchParams.get("aff") || "").trim();
  const hook = (url.searchParams.get("hook") || "").trim();
  const force = url.searchParams.get("force") === "1";

  if (!aff || !hook) {
    return json({ error: "missing aff or hook" }, 400, cors);
  }

  const hookStore = getStore({ name: "promo-hooks", consistency: "strong" });
  const imageStore = getStore({ name: "promo-hook-images", consistency: "strong" });
  const key = aff + ":" + hook;

  try {
    const record = (await hookStore.get(key, { type: "json" })) || {};

    // Always the deterministic cover image (same key hook-landing.html's
    // own ?slot=0 resolves to) — never hook-image.js's random gallery
    // rotation, so a scan and its cache stay tied to one specific image
    // rather than whichever gallery photo happened to be served that GET.
    let currentHash = record.imageHash || null;
    let imageResult = null;

    if (!currentHash) {
      // Older upload from before this feature shipped — no hash was ever
      // computed for it. Fetch once to see if an image even exists, and
      // backfill the hash so the next request can skip this branch.
      // Persisted right away (not left for the "regenerated" write further
      // down) because the very next check below can return early on a
      // cache hit — without persisting here first, that early return would
      // skip saving the backfilled hash entirely, and every future request
      // would redo this exact same fetch-and-hash for nothing.
      imageResult = await imageStore.getWithMetadata(key, { type: "arrayBuffer" });
      if (!imageResult) return json({ ok: true, available: false, reason: "no-image" }, 200, cors);
      currentHash = await sha256Hex(imageResult.data);
      record.imageHash = currentHash;
      // Merged into a freshly re-read copy of the record, not written back
      // via the `record` object read at the top of this request — see the
      // long comment on the write further down for why a stale full-object
      // write is a real lost-update hazard, not just theoretical.
      await mergeIntoRecord(hookStore, key, { imageHash: currentHash });
    }

    if (!force && record.aiCaption && record.aiImageHash === currentHash) {
      return json(
        { ok: true, available: true, cached: true, caption: record.aiCaption, hashtags: record.aiHashtags || null },
        200,
        cors
      );
    }

    if (!imageResult) {
      imageResult = await imageStore.getWithMetadata(key, { type: "arrayBuffer" });
      if (!imageResult) return json({ ok: true, available: false, reason: "no-image" }, 200, cors);
    }

    const mimeType = (imageResult.metadata && imageResult.metadata.contentType) || "image/jpeg";
    const caption = await draftCaptionFromImage(imageResult.data, mimeType);
    if (!caption) {
      // Best-effort — a missing API key, an unsupported image format, or a
      // failed call all land here. The modal falls back to the hook's
      // manually-typed caption, same as if this endpoint didn't exist.
      return json({ ok: true, available: false, reason: "scan-failed" }, 200, cors);
    }
    const hashtags = await generateHashtags(caption);

    // draftCaptionFromImage + generateHashtags together can easily take a
    // few seconds — long enough for something else (a new image upload, an
    // admin editing this same hook's booking/caption) to have written to
    // this record while we were waiting. Writing back the `record` object
    // read at the very top of this request would silently revert whatever
    // that other write just did (a real lost-update, not just a race in
    // theory), including possibly un-doing a *newer* imageHash than the
    // one we actually scanned. Re-reading fresh right before this write
    // and merging in only the AI result fields avoids that: if the image
    // did change mid-scan, aiImageHash here stays pinned to `currentHash`
    // (the image we actually scanned), which then simply won't match the
    // record's newer imageHash — correctly forcing a fresh scan next time,
    // rather than either losing the concurrent write or serving a cached
    // caption for the wrong image.
    await mergeIntoRecord(hookStore, key, { aiCaption: caption, aiHashtags: hashtags, aiImageHash: currentHash });

    return json({ ok: true, available: true, cached: false, caption: caption, hashtags: hashtags || null }, 200, cors);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500, cors);
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { "content-type": "application/json", ...cors },
  });
}

export const config = { path: "/api/hook-share-content" };
