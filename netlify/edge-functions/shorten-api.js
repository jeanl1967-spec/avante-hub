import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/l/I
const RANDOM_SLUG_LEN = 6;
const MAX_ALIAS_LEN = 40;

function randomSlug() {
  let out = "";
  for (let i = 0; i < RANDOM_SLUG_LEN; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function isSafeUrl(u) {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidAlias(a) {
  return /^[a-zA-Z0-9-]{2,40}$/.test(a);
}

export default async (request, context) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const store = getStore({ name: "short-links", consistency: "strong" });

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const slug = (url.searchParams.get("slug") || "").trim();
      if (!slug) {
        return new Response(JSON.stringify({ error: "missing slug" }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }
      const record = await store.get(slug, { type: "json" });
      if (!record) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json", ...cors },
        });
      }
      return new Response(JSON.stringify({ ok: true, slug, ...record }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid request body." }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      const longUrl = (body && body.url ? String(body.url) : "").trim();
      const requestedAlias = (body && body.alias ? String(body.alias) : "").trim();

      if (!longUrl || !isSafeUrl(longUrl)) {
        return new Response(JSON.stringify({ ok: false, error: "Please provide a valid link to shorten." }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      let slug;

      if (requestedAlias) {
        if (!isValidAlias(requestedAlias)) {
          return new Response(
            JSON.stringify({ ok: false, error: "Custom alias can only contain letters, numbers, and hyphens (2-40 characters)." }),
            { status: 400, headers: { "content-type": "application/json", ...cors } }
          );
        }
        const existing = await store.get(requestedAlias, { type: "json" });
        if (existing && existing.url && existing.url !== longUrl) {
          return new Response(JSON.stringify({ ok: false, error: "That short link name is already taken — try another." }), {
            status: 409,
            headers: { "content-type": "application/json", ...cors },
          });
        }
        slug = requestedAlias;
      } else {
        // Generate a random slug, retrying on the (rare) collision.
        for (let attempt = 0; attempt < 6; attempt++) {
          const candidate = randomSlug();
          const existing = await store.get(candidate, { type: "json" });
          if (!existing) {
            slug = candidate;
            break;
          }
        }
        if (!slug) {
          return new Response(JSON.stringify({ ok: false, error: "Could not generate a short link — please try again." }), {
            status: 500,
            headers: { "content-type": "application/json", ...cors },
          });
        }
      }

      const now = new Date().toISOString();
      const existingRecord = await store.get(slug, { type: "json" });
      const record = {
        url: longUrl,
        createdAt: (existingRecord && existingRecord.createdAt) || now,
        clicks: (existingRecord && existingRecord.clicks) || 0,
      };
      await store.setJSON(slug, record);

      return new Response(
        JSON.stringify({ ok: true, slug, shortUrl: "https://go.avantetravel.co.za/" + slug, ...record }),
        { headers: { "content-type": "application/json", ...cors } }
      );
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
};

export const config = { path: "/api/shorten" };
