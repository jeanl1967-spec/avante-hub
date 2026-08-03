import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

// The branded short-link domain. Every other host this site answers on
// (the main netlify.app domain, deploy previews, etc.) is left completely
// untouched by this function — it only ever acts when a request actually
// arrives on go.avantetravel.co.za.
const SHORT_HOST = "go.avantetravel.co.za";
const FALLBACK_URL = "https://stocknetwork-affiliate-link-builder.netlify.app/hub.html";

export default async (request, context) => {
  const url = new URL(request.url);

  if (url.hostname !== SHORT_HOST) {
    return context.next();
  }

  const slug = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");

  if (!slug) {
    return Response.redirect(FALLBACK_URL, 302);
  }

  const store = getStore({ name: "short-links", consistency: "strong" });

  try {
    const record = await store.get(slug, { type: "json" });

    if (!record || !record.url) {
      return new Response(
        "This short link doesn't exist or has expired.",
        { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    // Count the click without holding up the redirect.
    context.waitUntil(
      store.setJSON(slug, {
        ...record,
        clicks: (record.clicks || 0) + 1,
        lastClickAt: new Date().toISOString(),
      })
    );

    return Response.redirect(record.url, 302);
  } catch (err) {
    return new Response("Something went wrong resolving this link.", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
};

export const config = { path: "/*" };
