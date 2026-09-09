import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

const MAX_BYTES = 5 * 1024 * 1024;

export default async (request, context) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
};

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
}

  const url = new URL(request.url);
  const aff = (url.searchParams.get("aff") || "").trim();
  const hook = (url.searchParams.get("hook") || "").trim();
  // Optional — only ever used to GET one of the extra gallery photos a
  // hook's Auto-build "Use this" step may have saved (see admin-api.js's
  // saveHookPhotos). Distinguish "no ?slot= at all" (every single-image
  // caller — Hub, Share Kit, admin preview — which wants the rotation
  // below) from an explicit "?slot=0" (hook-landing.html's gallery asking
  // for its deterministic first frame, the cover, by index): both read
  // the same bare aff:hook key, but only the former should rotate.
  const hasSlot = url.searchParams.has("slot");
  const slot = (url.searchParams.get("slot") || "").trim();

  if (!aff || !hook) {
    return new Response(JSON.stringify({ error: "missing aff or hook" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
});
}

  const store = getStore({ name: "promo-hook-images", consistency: "strong" });
  // Read for GET rotation below; also read+written by DELETE, which clears
  // a hook's galleryCount back to 0 once its photos are gone (see below).
  const hookStore = getStore({ name: "promo-hooks", consistency: "strong" });
  let key = slot && slot !== "0" ? aff + ":" + hook + ":" + slot : aff + ":" + hook;

  try {
    if (request.method === "DELETE") {
      // Removes this hook's current image entirely (cover photo plus any
      // extra gallery slots Auto-build's photo picker saved alongside it —
      // otherwise the cover key would be gone but the GET rotation above
      // would still occasionally serve one of the now-orphaned gallery
      // slots at random, making "delete image" look like it didn't work).
      let galleryCount = 0;
      let record = null;
      try {
        record = await hookStore.get(aff + ":" + hook, { type: "json" });
        galleryCount = (record && record.galleryCount) || 0;
      } catch (e) {
        // best-effort — if this lookup fails we still delete the cover key below
      }

      const keysToDelete = [aff + ":" + hook];
      for (let s = 1; s <= galleryCount; s++) keysToDelete.push(aff + ":" + hook + ":" + s);
      await Promise.all(keysToDelete.map((k) => store.delete(k).catch(() => {})));

      if (record && galleryCount > 0) {
        record.galleryCount = 0;
        record.updatedAt = new Date().toISOString();
        await hookStore.setJSON(aff + ":" + hook, record).catch(() => {});
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...cors },
});
}

    if (request.method === "POST") {
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        return new Response(JSON.stringify({ error: "file must be an image" }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
});
}

      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        return new Response(JSON.stringify({ error: "image too large (max 5MB)" }), {
          status: 413,
          headers: { "content-type": "application/json", ...cors },
});
}

      await store.set(key, buf, { metadata: { contentType } });

      // A plain manual upload (no ?slot=) always replaces this hook's
      // *whole* image, not just its cover frame — so any leftover
      // Auto-build gallery photos from before must go too. Without this,
      // they'd sit around referenced by galleryCount and the GET rotation
      // above would keep occasionally serving one of them at random,
      // instead of the image just uploaded. An explicit ?slot= POST (no
      // current caller sends one, but defensively) is a single-slot
      // write, not a full replace, so it skips this.
      if (key === aff + ":" + hook) {
        try {
          const record = await hookStore.get(key, { type: "json" });
          const galleryCount = (record && record.galleryCount) || 0;
          if (galleryCount > 0) {
            const staleSlots = [];
            for (let s = 1; s <= galleryCount; s++) staleSlots.push(key + ":" + s);
            await Promise.all(staleSlots.map((k) => store.delete(k).catch(() => {})));
            record.galleryCount = 0;
            await hookStore.setJSON(key, record).catch(() => {});
          }
        } catch (e) {
          // best-effort — the cover upload above already succeeded either way
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...cors },
});
}

    // GET, no ?slot= at all: if this hook has extra gallery photos (saved
    // by Auto-build's photo picker), rotate — pick a random one of the
    // saved photos (the cover or any gallery slot) on every request
    // instead of always the same fixed cover, so every place this image
    // shows (Hub, Share Kit, admin preview) naturally cycles through the
    // set. A hook with no gallery photos (the overwhelming majority —
    // anything not built with Auto-build's multi-photo picker) behaves
    // exactly as before: the one key it has ever had. An explicit
    // ?slot=0 (hook-landing.html's gallery asking for its first frame by
    // index) is deliberately excluded from rotation — it wants that exact
    // frame, not a random one.
    if (!hasSlot) {
      try {
        const hookRecord = await hookStore.get(aff + ":" + hook, { type: "json" });
        const galleryCount = (hookRecord && hookRecord.galleryCount) || 0;
        if (galleryCount > 0) {
          const pick = Math.floor(Math.random() * (galleryCount + 1)); // 0 = cover, 1..N = gallery slots
          if (pick > 0) key = aff + ":" + hook + ":" + pick;
        }
      } catch (e) {
        // best-effort — any lookup failure just falls back to the cover key
      }
    }

    const result = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!result) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json", ...cors },
});
}

    const contentType = (result.metadata && result.metadata.contentType) || "application/octet-stream";
    return new Response(result.data, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=300",
        ...cors,
},
});
} catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
});
}
};

export const config = { path: "/api/hook-image" };
