import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

// Special affiliate key reserved for admin-managed default hook content.
// Chosen so it can never collide with a real affiliate ID (StockNetwork
// GUIDs / affiliate numbers never contain double underscores).
const ADMIN_KEY = "__admin__";

// Host used by the link shortener (go-redirect.js). Admin-set booking links
// are sometimes shortened before being saved — to personalize the real
// destination per affiliate we need to resolve the short link back to its
// original long URL first.
const SHORT_HOST = "go.avantetravel.co.za";

// Pull the CheckInDT=YYYY-MM-DD date off a booking link built by the
// Accommodation Link Builder, if present. Links pasted in by hand (or built
// from other tools) may not have one at all — that's fine, it just means
// there's nothing to expire.
function parseCheckInDate(bookingUrl) {
  if (!bookingUrl) return null;
  try {
    const u = new URL(bookingUrl);
    const raw = u.searchParams.get("CheckInDT");
    if (!raw) return null;
    const d = new Date(raw + "T00:00:00Z");
    if (isNaN(d.getTime())) return null;
    return d;
  } catch (e) {
    return null;
  }
}

function todayUTCDateOnly() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// StockNetwork's "/ui/<id>" booking links carry the site identifier as the
// last path segment. Self-managed hooks put the affiliate's own Hub ID
// there; admin-authored promo links instead often use a short
// "Affiliate <number>" form (StockNetwork's own site number) so the
// booking gets attributed to whichever site the admin built the promo for.
// To make an admin-managed hook still credit the *viewing* affiliate, we
// swap that number out for their own StockNetwork Site Nr wherever we
// recognize this exact pattern. Any other URL shape is left untouched —
// we only ever touch a link we can confidently recognize.
function personalizeStockNetworkUrl(rawUrl, siteNr) {
  if (!rawUrl || !siteNr) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const parts = u.pathname.split("/");
    let lastIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i]) { lastIdx = i; break; }
    }
    if (lastIdx === -1) return rawUrl;
    let seg;
    try {
      seg = decodeURIComponent(parts[lastIdx]);
    } catch (e) {
      return rawUrl;
    }
    if (!/^Affiliate\s+\d+$/i.test(seg)) return rawUrl;
    parts[lastIdx] = encodeURIComponent("Affiliate " + siteNr);
    u.pathname = parts.join("/");
    return u.toString();
  } catch (e) {
    return rawUrl;
  }
}

// If the admin's stored booking link is one of our own shortened
// go.avantetravel.co.za links, resolve it back to the real destination so
// we have something we can actually personalize. Falls back to the
// original URL untouched if it isn't one of ours or the lookup fails.
async function resolveShortLink(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    if (u.hostname !== SHORT_HOST) return rawUrl;
    const slug = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!slug) return rawUrl;
    const shortStore = getStore({ name: "short-links", consistency: "strong" });
    const record = await shortStore.get(slug, { type: "json" });
    return record && record.url ? record.url : rawUrl;
  } catch (e) {
    return rawUrl;
  }
}

async function personalizeBooking(rawUrl, siteNr) {
  const resolved = await resolveShortLink(rawUrl);
  return personalizeStockNetworkUrl(resolved, siteNr);
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
      const existing = (await store.get(key, { type: "json" })) || {};
      const record = { ...existing };

      if (typeof body.booking === "string") record.booking = body.booking;
      if (typeof body.landing === "string") record.landing = body.landing;
      if (typeof body.caption === "string") record.caption = body.caption;
      if (body.mode === "self" || body.mode === "admin") record.mode = body.mode;
      if (!record.mode) record.mode = "admin";
      record.savedAt = new Date().toISOString();

      await store.setJSON(key, record);
      return new Response(JSON.stringify({ ok: true, record: record }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // GET — resolve what should actually be shown for this hook.
    const affRecord = await store.get(key, { type: "json" });
    const mode = (affRecord && affRecord.mode) === "self" ? "self" : "admin";

    let source = mode;
    let expired = false;

    if (mode === "self") {
      const checkIn = parseCheckInDate(affRecord && affRecord.booking);
      if (checkIn && todayUTCDateOnly() >= checkIn) {
        source = "admin";
        expired = true;
      }
    }

    if (aff === ADMIN_KEY) {
      // The admin's own default record — no resolution needed, just return it.
      const data = affRecord ? { ...affRecord } : null;
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (source === "admin") {
      const adminRecord = await store.get(ADMIN_KEY + ":" + hook, { type: "json" });

      let personalizedBooking = adminRecord ? adminRecord.booking || "" : "";
      if (personalizedBooking) {
        // Look up this affiliate's StockNetwork Site Nr so admin-authored
        // booking links can be attributed to them, not to whichever site
        // the admin happened to build the link for.
        try {
          const directoryStore = getStore({ name: "affiliates-directory", consistency: "strong" });
          const affDirRecord = await directoryStore.get(aff, { type: "json" });
          const siteNr = (affDirRecord && affDirRecord.siteNr) || "";
          personalizedBooking = await personalizeBooking(personalizedBooking, siteNr);
        } catch (e) {
          // Best-effort — fall back to the admin's link exactly as saved.
        }
      }

      const data = adminRecord
        ? { booking: personalizedBooking, landing: adminRecord.landing || "", caption: adminRecord.caption || "", mode: mode, source: "admin", expired: expired }
        : { mode: mode, source: "admin", expired: expired };
      // If there's genuinely nothing to show (no admin default set either),
      // return null so callers treat this hook slot as inactive — same as
      // the old behaviour for an empty hook.
      const hasContent = adminRecord && (adminRecord.booking || adminRecord.landing);
      return new Response(JSON.stringify(hasContent ? data : null), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // source === "self"
    const data = affRecord
      ? { booking: affRecord.booking || "", landing: affRecord.landing || "", caption: affRecord.caption || "", mode: mode, source: "self", expired: expired }
      : null;
    return new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
};

export const config = { path: "/api/hook" };
