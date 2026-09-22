// Reads a hook's own already-saved photos (stored by saveHookPhotoUrls —
// see lib/hook-photos.js — cover at `key`, gallery at `key:1`, `key:2`, ...)
// out of the promo-hook-images store and turns them into data: URIs, so
// lib/hook-flyer-svg.js can embed them directly into the generated SVG.
// This is the ONLY place image bytes are touched for the flyer feature —
// no fetch to StockNetwork or Canva happens here, just reading bytes this
// app already fetched and stored once when the hook's photos were saved.
//
// Deno-safe base64 encoding (no Buffer): chunks the byte array so a large
// photo doesn't blow call-stack limits on String.fromCharCode.apply.
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// imageStore: "promo-hook-images" store. key: the hook's own key
// ("__admin__:<n>" or "<affId>:<hook>"). galleryCount: from the hook
// record — how many extra gallery slots exist beyond the cover photo.
// slotKeys: template.images.map(i => i.key), in the order saved photos
// should fill them (cover photo first). Returns { [slotKey]: dataUri } —
// a slot with no corresponding saved photo is simply omitted, so
// renderFlyerSVG leaves that box empty rather than reusing another photo.
export async function fetchFlyerImages(imageStore, key, galleryCount, slotKeys) {
  const count = Math.max(0, Number(galleryCount) || 0);
  const blobKeys = [key];
  for (let i = 1; i <= count; i++) blobKeys.push(key + ":" + i);

  const out = {};
  for (let i = 0; i < slotKeys.length && i < blobKeys.length; i++) {
    try {
      const result = await imageStore.getWithMetadata(blobKeys[i], { type: "arrayBuffer" });
      if (!result || !result.data) continue;
      const contentType = (result.metadata && result.metadata.contentType) || "image/jpeg";
      out[slotKeys[i]] = "data:" + contentType + ";base64," + bufferToBase64(result.data);
    } catch (e) {
      // Missing/unreadable photo — leave this slot unfilled rather than
      // failing the whole flyer render.
    }
  }
  return out;
}
