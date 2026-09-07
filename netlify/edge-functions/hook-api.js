import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";
import { generateHashtags } from "./lib/hashtag-helper.js";
import { resolveShortLink as resolveShortLinkShared, isShortLink } from "./lib/short-link.js";
import { correctBookingLinkSiteId } from "./lib/booking-link.js";

// Special affiliate key reserved for admin-managed default hook content.
// Chosen so it can never collide with a real affiliate ID (StockNetwork
// GUIDs / affiliate numbers never contain double underscores).
const ADMIN_KEY = "__admin__";

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
// swap that last segment out for `replacement` wherever we recognize this
// exact "Affiliate <number>" pattern. Any other URL shape is left
// untouched — we only ever touch a link we can confidently recognize.
function personalizeStockNetworkUrl(rawUrl, replacement) {
  if (!rawUrl || !replacement) return rawUrl;
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
    parts[lastIdx] = encodeURIComponent(replacement);
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
  const shortStore = getStore({ name: "short-links", consistency: "strong" });
  return resolveShortLinkShared(rawUrl, shortStore);
}

async function personalizeBooking(rawUrl, replacement) {
  const resolved = await resolveShortLink(rawUrl);
  return personalizeStockNetworkUrl(resolved, replacement);
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
      // A StockNetwork booking link's site identifier not matching this
      // affiliate's own id is the specific mistake admin-api.js's
      // fixMisattributedHookLinks exists to clean up (see there for the
      // full story: it silently sends every booking through this hook to
      // whoever that other id belongs to instead) — guard against writing
      // that state back here too, so it can't be immediately re-created
      // after being fixed. `aff` is this exact hook's own affiliate, from
      // the ?aff= this request came in on — always the right id to
      // enforce here, EXCEPT for ADMIN_KEY itself: this endpoint has no
      // auth check at all, and admin's own default hook record
      // (aff === ADMIN_KEY) is *supposed* to keep carrying the shared
      // "Affiliate <N>" placeholder, not get "corrected" to the literal
      // string "__admin__" — which would break personalization for every
      // affiliate this default hook still serves. fixMisattributedHookLinks
      // already excludes ADMIN_KEY: records the same way.
      if (aff !== ADMIN_KEY) {
        record.booking = correctBookingLinkSiteId(record.booking, aff).url;
      }
      // Booking link and Landing page link ending up set to the exact
      // same short link is the specific mistake admin-api.js's
      // fixCollapsedHookLinks exists to clean up (see there for the full
      // story) — guard against writing that state back here too, so it
      // can't be immediately re-created after being fixed.
      if (record.landing && record.landing === record.booking && isShortLink(record.booking)) {
        record.landing = "";
      }
      if (typeof body.caption === "string") {
        record.caption = body.caption;
        // Regenerate platform hashtags whenever the caption is (re)saved.
        // Best-effort: a failed/unavailable AI call just clears the cached
        // set rather than blocking the save.
        const newHashtags = await generateHashtags(record.caption);
        if (newHashtags) record.hashtags = newHashtags;
        else delete record.hashtags;
      }
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
      // The admin's own default record — no resolution needed, just return
      // it as-is, plus a `details` alias for the stored `source` metadata
      // (Auto-build's property/area info) so hook-landing.html can read it
      // the same way it does for every other caller below — without
      // renaming or removing the existing `source` field, which already
      // means something else (rich metadata, not admin/self routing) only
      // on this raw admin record.
      const data = affRecord ? { ...affRecord, details: affRecord.source || null } : null;
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
        // the admin happened to build the link for. Site Nr is an optional,
        // admin-set field though — an affiliate can exist without one on
        // file. Rather than silently leaving the link on the admin's own
        // placeholder site in that case (crediting Jean's master account
        // instead of the affiliate), fall back to the affiliate's own Hub
        // ID — the same ID self-managed hooks already use as their booking
        // link's site identifier.
        try {
          const directoryStore = getStore({ name: "affiliates-directory", consistency: "strong" });
          const affDirRecord = await directoryStore.get(aff, { type: "json" });
          const siteNr = (affDirRecord && affDirRecord.siteNr) || "";
          const replacement = siteNr ? "Affiliate " + siteNr : aff;
          personalizedBooking = await personalizeBooking(personalizedBooking, replacement);
        } catch (e) {
          // Best-effort — fall back to the admin's link exactly as saved.
        }
      }

      // "details" carries the real property/area info Auto-build scraped
      // (name, description, attractions, room type) when this hook was
      // built that way — used by the new hook-landing.html page for its
      // "full details" view. Deliberately not called "source" here, since
      // that name is already used below for the admin/self routing field.
      const data = adminRecord
        ? {
            booking: personalizedBooking,
            landing: adminRecord.landing || "",
            caption: adminRecord.caption || "",
            hashtags: adminRecord.hashtags || null,
            galleryCount: adminRecord.galleryCount || 0,
            details: adminRecord.source || null,
            mode: mode,
            source: "admin",
            expired: expired,
          }
        : { mode: mode, source: "admin", expired: expired };
      // If there's genuinely nothing to show (no admin default set either),
      // return null so callers treat this hook slot as inactive — same as
      // the old behaviour for an empty hook.
      const hasContent = adminRecord && (adminRecord.booking || adminRecord.landing);
      return new Response(JSON.stringify(hasContent ? data : null), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // source === "self". Auto-build is admin-only for now, so galleryCount/
    // details will normally be absent here — passed through defensively
    // for shape consistency with the admin branch above.
    const data = affRecord
      ? {
          booking: affRecord.booking || "",
          landing: affRecord.landing || "",
          caption: affRecord.caption || "",
          hashtags: affRecord.hashtags || null,
          galleryCount: affRecord.galleryCount || 0,
          details: affRecord.source || null,
          mode: mode,
          source: "self",
          expired: expired,
        }
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
