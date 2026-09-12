import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";
import { draftCaptionFromImage, isSupportedImageMediaType } from "./lib/vision-caption-helper.js";
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
// affiliate id otherwise). But unlike those two (which only ever do cheap
// blob-store I/O), every real generation here is a billed Claude call —
// "unauthenticated" here means anyone who can guess an aff:hook pair (a
// small, well-known set for admin's own hooks) could otherwise loop
// requests to run up API costs with no rate limiting at all: not just via
// ?force=1 (an explicit cache bypass), but also a hook whose scan simply
// keeps failing (never reaching the cache-hit branch, so nothing would
// otherwise throttle retrying it) or a burst of near-simultaneous
// first-ever requests for an image nothing has cached yet. See
// ATTEMPT_COOLDOWN_MS below for the mitigation and its own limits.
//
// Caching: the scan is expensive (an LLM vision call) and the modal can be
// opened many times for the same unchanged image, so the result is cached
// on the hook's own record (in the shared "promo-hooks" store) alongside
// the image hash it was generated from. A later request only re-scans when
// that hash no longer matches the hook's current image (i.e. the image was
// replaced) or the caller explicitly asks for one via ?force=1 (the
// modal's "Regenerate" button) — throttled below so this can't be looped.
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

  // Any real generation attempt — successful or not, forced or the
  // natural "nothing cached yet" fallthrough — costs a real paid API
  // call. Without a floor on how often that can happen *per hook*
  // (regardless of force), looping requests against the same hook is an
  // unbounded billing vector (this endpoint has no other rate limiting or
  // auth), and a hook whose scan just keeps failing would otherwise never
  // even reach the cache-hit check that would normally protect it. A
  // cache hit is never throttled — this only ever gates an actual attempt
  // about to be made, checked and marked right before it happens (see
  // below). This is a best-effort floor, not a hard guarantee: a burst of
  // near-simultaneous requests arriving before the first one's own marker
  // write has landed could still each trigger a real call — closing that
  // fully would need real distributed rate-limiting, overkill for this
  // app's actual exposure (a small, known set of hooks for one business,
  // not a public mass-market target).
  const ATTEMPT_COOLDOWN_MS = 30 * 1000;

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
      const backfilledHash = await sha256Hex(imageResult.data);

      // Unlike the writes further down, this can't just use
      // mergeIntoRecord's blind merge: imageHash is the record's one
      // ground-truth pointer to "what the current cover image actually
      // is" (aiImageHash is allowed to lag it — that's the whole cache
      // check below — but imageHash itself never should). The two awaits
      // above (fetch, then hash) are enough of a window for a concurrent
      // hook-image.js upload to have already written a newer, real
      // imageHash — blindly merging our own guess over that would revert
      // a real, current value back to a stale one, which a plain
      // "preserve other fields" merge wouldn't catch since imageHash IS
      // the field being written. So: only persist ours if the record
      // still has none, and either way use whatever's actually there now
      // as currentHash — never our own possibly-stale computation.
      const freshForBackfill = (await hookStore.get(key, { type: "json" })) || {};
      if (!freshForBackfill.imageHash) {
        // Uses mergeIntoRecord here too (rather than mutating
        // freshForBackfill and writing it directly, which would be
        // exactly as safe — both read fresh immediately before writing
        // with no await in between — but less obviously so to a future
        // reader) purely for consistency with every other write in this
        // file, so "is this one safe?" never has to be re-derived by eye.
        await mergeIntoRecord(hookStore, key, { imageHash: backfilledHash });
        currentHash = backfilledHash;
      } else {
        // A concurrent upload got there first — currentHash now points to
        // its real, newer hash, but `imageResult` above still holds the
        // OLD cover's bytes (fetched before that upload landed). Scanning
        // those now-stale bytes and tagging the result as aiImageHash:
        // currentHash (the NEW hash) would describe the wrong image while
        // looking, to every future cache check, exactly like a valid scan
        // of the current one. Discard imageResult so the fetch further
        // down (which only runs when it's still null) picks up the real
        // current bytes instead.
        currentHash = freshForBackfill.imageHash;
        imageResult = null;
      }
    }

    if (!force && record.aiCaption && record.aiImageHash === currentHash) {
      return json(
        { ok: true, available: true, cached: true, caption: record.aiCaption, hashtags: record.aiHashtags || null },
        200,
        cors
      );
    }

    // We're past the cache-hit check, so a real generation attempt is
    // about to be made — throttle that specifically, not requests in
    // general, so an already-cached, unchanged image stays instant and
    // free no matter how often the modal is opened. lastAttemptAt is
    // deliberately never cleared elsewhere (not on image delete, not on a
    // cover replace) — it tracks "how recently did this hook burn a real
    // API call", independent of which image or cache state that was for,
    // which also closes the narrower version of this same loophole where
    // repeatedly re-uploading trivially different images would otherwise
    // keep defeating the imageHash-based cache.
    if (record.lastAttemptAt) {
      const sinceAttemptMs = Date.now() - new Date(record.lastAttemptAt).getTime();
      if (isFinite(sinceAttemptMs) && sinceAttemptMs < ATTEMPT_COOLDOWN_MS) {
        // Only ever fall back to the cached caption here if it actually
        // describes the CURRENT image — the cache-hit check above already
        // failed by the time we reach this point, meaning either there's
        // no cache yet or (just as likely) the image has since changed.
        // Serving record.aiCaption unconditionally would present a stale
        // caption for a now-different photo as if it were valid, current,
        // cached content — worse than declining outright.
        if (record.aiCaption && record.aiImageHash === currentHash) {
          return json(
            {
              ok: true,
              available: true,
              cached: true,
              throttled: true,
              caption: record.aiCaption,
              hashtags: record.aiHashtags || null,
            },
            200,
            cors
          );
        }
        return json({ ok: true, available: false, reason: "rate-limited" }, 200, cors);
      }
    }
    if (!imageResult) {
      imageResult = await imageStore.getWithMetadata(key, { type: "arrayBuffer" });
      // Deliberately returns here, before marking lastAttemptAt at all —
      // there is no image to scan, so no real (billed) attempt was made,
      // and stamping the cooldown anyway would throttle the *next*
      // request even once a real image shows up (e.g. upload one, then
      // reopen the modal within the cooldown window: that's a genuine
      // first-ever scan, not a repeat, and must not be held back by a
      // cooldown from a request that never reached the paid API at all).
      if (!imageResult) return json({ ok: true, available: false, reason: "no-image" }, 200, cors);

      // For a hook that already had an imageHash (skipping the backfill
      // branch above entirely), currentHash has been sitting unverified
      // since the record read at the very top of this request. Refresh it
      // now, right alongside actually fetching the bytes we're about to
      // scan: a concurrent upload landing in that gap would otherwise
      // leave us writing aiImageHash: (the old, stale hash) further down
      // for a caption generated from different, newer bytes — never wrong
      // content (the caption itself always describes whatever was
      // actually fetched), but a mislabeled cache entry that forces one
      // avoidable extra scan next time. The backfill branch above already
      // has its own equivalent re-check before ever reaching this point.
      const freshRecord = await hookStore.get(key, { type: "json" });
      if (freshRecord && freshRecord.imageHash) currentHash = freshRecord.imageHash;
    }

    const mimeType = (imageResult.metadata && imageResult.metadata.contentType) || "image/jpeg";

    // Same reasoning as the no-image check above: known for free, no
    // network call involved, so it must not burn the attempt cooldown —
    // otherwise replacing an unsupported-format image with a valid one
    // and reopening the modal within the cooldown window would wrongly
    // block that genuinely first-ever scan too.
    if (!isSupportedImageMediaType(mimeType)) {
      return json({ ok: true, available: false, reason: "scan-failed" }, 200, cors);
    }

    // Marked right before the real (billed) attempt, not any earlier — so
    // a burst of near-simultaneous requests all reading a not-yet-updated
    // lastAttemptAt can't all slip past the check above before any of
    // them finish (see the module comment for this mitigation's limits).
    // A missing ANTHROPIC_API_KEY still gets marked here even though
    // draftCaptionFromImage will bail for free in that case too — left
    // as is, since a missing key breaks every AI feature on the whole
    // site, not just this one hook, and is something to fix in the
    // environment, not a per-hook throttling nuance worth chasing.
    await mergeIntoRecord(hookStore, key, { lastAttemptAt: new Date().toISOString() });

    const caption = await draftCaptionFromImage(imageResult.data, mimeType);
    if (!caption) {
      // Best-effort — a missing API key or a failed call land here (an
      // unsupported format was already handled above, before the
      // cooldown mark). The modal falls back to the hook's manually-typed
      // caption, same as if this endpoint didn't exist.
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
    await mergeIntoRecord(hookStore, key, {
      aiCaption: caption,
      aiHashtags: hashtags,
      aiImageHash: currentHash,
      aiGeneratedAt: new Date().toISOString(),
    });

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
