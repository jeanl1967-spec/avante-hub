import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

// Stores small per-affiliate preference flags (currently just whether the
// "Add to Home Screen" popup should be permanently hidden). Keyed by
// affiliate ID, server-side, so a dismissal follows the affiliate across
// every device/browser they use — not just the one they dismissed it on.
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

  if (!aff) {
    return new Response(JSON.stringify({ error: "missing aff" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  const store = getStore({ name: "affiliate-prefs", consistency: "strong" });

  try {
    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "invalid JSON" }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }
      const existing = (await store.get(aff, { type: "json" })) || {};
      const record = {
        ...existing,
        hideA2HS: !!body.hideA2HS,
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(aff, record);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // GET
    const data = await store.get(aff, { type: "json" });
    return new Response(JSON.stringify(data || null), {
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
};

export const config = { path: "/api/prefs" };
