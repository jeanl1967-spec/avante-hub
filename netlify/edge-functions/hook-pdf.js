import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

// Lets a hook's "Landing page link" point at an uploaded PDF (a brochure,
// rate sheet, flyer) instead of our own hook-landing.html page — admin.html
// and hub.html both fill the Landing page link field with this endpoint's
// URL once a PDF is uploaded, exactly the same "fill the field, still
// needs Save" pattern as the other link builders. One PDF per hook, no
// gallery/rotation concept (unlike hook-image.js) — simple replace.
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

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

  if (!aff || !hook) {
    return new Response(JSON.stringify({ error: "missing aff or hook" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  const store = getStore({ name: "promo-hook-pdfs", consistency: "strong" });
  const key = aff + ":" + hook;

  try {
    if (request.method === "DELETE") {
      await store.delete(key);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (request.method === "POST") {
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("application/pdf")) {
        return new Response(JSON.stringify({ error: "file must be a PDF" }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) {
        return new Response(JSON.stringify({ error: "PDF too large (max 10MB)" }), {
          status: 413,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      // Cheap real-format check beyond the client-supplied content-type
      // (which a caller could get wrong or fake) — every valid PDF starts
      // with the literal bytes "%PDF-".
      const head = new Uint8Array(buf.slice(0, 5));
      const headStr = String.fromCharCode(...head);
      if (headStr !== "%PDF-") {
        return new Response(JSON.stringify({ error: "file is not a valid PDF" }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      await store.set(key, buf, { metadata: { contentType: "application/pdf" } });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // GET — serve the PDF inline (opens like a normal page/tab, no
    // surprise download prompt), same as clicking through to
    // hook-landing.html would have done.
    const result = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!result) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json", ...cors },
      });
    }

    return new Response(result.data, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="hook-' + encodeURIComponent(hook) + '.pdf"',
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

export const config = { path: "/api/hook-pdf" };
