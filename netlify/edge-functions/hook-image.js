import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

const MAX_BYTES = 5 * 1024 * 1024;

export default async (request, context) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
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
  // Only read for GET rotation below — never written here.
  const hookStore = getStore({ name: "promo-hooks", consistency: "strong" });
  let key = slot && slot !== "0" ? aff + ":" + hook + ":" + slot : aff + ":" + hook;

  try {
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
