import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

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

  if (!aff || !hook) {
    return new Response(JSON.stringify({ error: "missing aff or hook" }), {
            status: 400,
            headers: { "content-type": "application/json", ...cors },
      });
  }

  const store = getStore({ name: "promo-hooks", consistency: "strong" });
  const key = aff + ":" + hook;

  try {
    if (request.method === "POST") {
      const body = await request.json();
      const record = {
                booking: typeof body.booking === "string" ? body.booking : "",
                          landing: typeof body.landing === "string" ? body.landing : "",
                          savedAt: new Date().toISOString(),
                  };
      await store.setJSON(key, record);
      return new Response(JSON.stringify({ ok: true }), {
                headers: { "content-type": "application/json", ...cors },
        });
      }

    const data = await store.get(key, { type: "json" });
    return new Response(JSON.stringify(data || null), {
            headers: { "content-type": "application/json", ...cors },
      });
    } catch (err) {
          return new Response(JSON.stringify({ error: String(err && err.message || err) }), {
            status: 500,
            headers: { "content-type": "application/json", ...cors },
      });
  }
    };

export const config = { path: "/api/hook" };
