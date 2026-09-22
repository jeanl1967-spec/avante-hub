// Shared "transfer admin-picked candidate photos into our own image store"
// logic — the exact same behavior admin-api.js's saveHookPhotos action has
// always used for Default Hooks, pulled out here so hook-api.js can offer
// the identical self-managed equivalent for affiliates in hub.html without
// duplicating ~140 lines. admin-api.js's own saveHookPhotos action now just
// calls this with key = "__admin__:" + n; hook-api.js calls it with
// key = "<affId>:" + hook.
//
// `key` is used as-is for both the promo-hooks record key and the
// promo-hook-images blob key prefix — exactly how the original admin-only
// code always keyed both stores, just no longer hardcoded to "__admin__:".
import { sha256Hex } from "./image-hash.js";
import { mergeIntoRecord, AI_SCAN_CACHE_FIELDS_CLEARED } from "./record-merge.js";
import { mapWithConcurrency } from "./booking-stats.js";

// hookStore: "promo-hooks" store. imageStore: "promo-hook-images" store.
// urls: candidate photo URLs (already capped/deduped by the caller).
// source: optional { mode, label, description, attractions, roomType, names } —
// carried straight through from buildHookDraft's response, same as before.
// Returns { ok, saved, failed, galleryCount }.
export async function saveHookPhotoUrls(hookStore, imageStore, key, urls, source) {
  if (!urls.length) return { ok: false, saved: 0, failed: 0, galleryCount: 0, error: "No photos selected." };

  let saved = 0;
  let coverBuf = null;
  const failed = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim();
    try {
      const res = await fetch(url);
      if (!res.ok) {
        failed.push(url);
        continue;
      }
      const contentType = res.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        failed.push(url);
        continue;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 5 * 1024 * 1024 || buf.byteLength < 1) {
        failed.push(url);
        continue;
      }
      const isCover = saved === 0;
      const imageKey = isCover ? key : key + ":" + saved;
      await imageStore.set(imageKey, buf, { metadata: { contentType: contentType, sourceUrl: url } });
      if (isCover) coverBuf = buf;
      saved++;
    } catch (e) {
      failed.push(url);
    }
  }

  const galleryCount = Math.max(0, saved - 1);

  if (saved > 0) {
    const existing = (await hookStore.get(key, { type: "json" })) || {};
    const previousGalleryCount = existing.galleryCount || 0;

    const fields = { galleryCount: galleryCount, updatedAt: new Date().toISOString() };
    if (coverBuf) {
      const newImageHash = await sha256Hex(coverBuf);
      if (newImageHash !== existing.imageHash) {
        Object.assign(fields, AI_SCAN_CACHE_FIELDS_CLEARED);
      }
      fields.imageHash = newImageHash;
    }
    if (source && typeof source === "object") {
      fields.source = {
        mode: source.mode === "area" ? "area" : "property",
        label: typeof source.label === "string" ? source.label.trim().slice(0, 200) : "",
        description: typeof source.description === "string" ? source.description.trim().slice(0, 2000) : "",
        attractions: typeof source.attractions === "string" ? source.attractions.trim().slice(0, 2000) : "",
        roomType: typeof source.roomType === "string" ? source.roomType.trim().slice(0, 100) : "",
        names: Array.isArray(source.names) ? source.names.filter((x) => typeof x === "string").slice(0, 10) : [],
      };
    }
    await mergeIntoRecord(hookStore, key, fields);

    if (previousGalleryCount > galleryCount) {
      const staleSlots = [];
      for (let slot = galleryCount + 1; slot <= previousGalleryCount; slot++) staleSlots.push(slot);
      await mapWithConcurrency(staleSlots, (slot) => imageStore.delete(key + ":" + slot).catch(() => {}));
    }
  }

  return { ok: saved > 0, saved: saved, failed: failed.length, galleryCount: galleryCount };
}
