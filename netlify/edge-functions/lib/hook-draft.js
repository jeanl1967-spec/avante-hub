// Shared "build a hook draft from a property or area" logic — the exact
// same behavior admin-api.js's generateHookDraft action has always used
// for the Default Hooks Auto-build feature, pulled out here so hook-api.js
// can offer the identical self-managed equivalent for affiliates in
// hub.html without duplicating ~150 lines (and, more importantly, without
// the two copies silently drifting apart over time). admin-api.js's own
// generateHookDraft action now just calls this and shapes the JSON
// response the same way it always returned.
//
// Every field this returns is sourced from real StockNetwork data
// (fetchResortInfo's scrape) or Claude's caption drafted directly from
// that scraped content — nothing here invents property details, per the
// no-invented-flyer-content rule the rest of this app already follows.
import { fetchResortInfo, draftHookCaption } from "./hook-source.js";
import { generateHashtags } from "./hashtag-helper.js";
import { ADMIN_MASTER_SITE_GUID } from "./booking-link.js";

// resortStore: the "resort-list" Netlify Blobs store (read-only here).
// input: { resortId?, siteId?, query?, bookingSiteGuid? } — bookingSiteGuid
// is the placeholder StockNetwork site GUID to build the booking link
// against (ADMIN_MASTER_SITE_GUID for an admin default hook, so
// hook-api.js's existing personalizeStockNetworkUrl can re-attribute it
// per-viewer the same way it already does; an affiliate's own real
// StockNetwork site GUID for a self-managed hook, which needs no
// re-attribution since it's already that affiliate's own link).
// Returns { ok: true, ...draft } or { ok: false, error, status }.
export async function buildHookDraft(resortStore, input) {
  const bodyResortId = typeof input.resortId === "string" ? input.resortId.trim() : "";
  const bodySiteId = typeof input.siteId === "string" ? input.siteId.trim() : "";
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const bookingSiteGuid = input.bookingSiteGuid || ADMIN_MASTER_SITE_GUID;

  if (!bodyResortId && !query) {
    return { ok: false, error: "Type or pick a property or area first.", status: 400 };
  }

  let mode = "property";
  let label = query;
  let sources = [];

  if (bodyResortId) {
    const info = await fetchResortInfo(bodyResortId, bodySiteId);
    if (!info) {
      return { ok: false, error: "Couldn't load that property's info page. Try again, or pick a different one.", status: 502 };
    }
    sources = [info];
    label = info.name || label;
  } else {
    const listRecord = await resortStore.get("current", { type: "json" });
    const allResorts = listRecord && Array.isArray(listRecord.resorts) ? listRecord.resorts : [];
    const queryLower = query.toLowerCase();

    let propertyMatch = allResorts.find((r) => r.name && r.name.toLowerCase() === queryLower);
    // Only fall back to a loose "name contains this text" match if there
    // isn't an exact area match available — see admin-api.js's original
    // generateHookDraft for the "63 Milkwood Knysna" story this guards
    // against.
    if (!propertyMatch) {
      const hasExactDistrictMatch = allResorts.some((r) => r.district && r.district.toLowerCase() === queryLower);
      if (!hasExactDistrictMatch) {
        propertyMatch = allResorts.find((r) => r.name && r.name.toLowerCase().includes(queryLower));
      }
    }

    if (propertyMatch) {
      label = propertyMatch.name;
      const info = await fetchResortInfo(propertyMatch.resortId, propertyMatch.siteId);
      if (!info) {
        return { ok: false, error: "Couldn't load that property's info page. Try again, or pick a different one.", status: 502 };
      }
      sources = [info];
    } else {
      mode = "area";
      let matches = allResorts.filter((r) => r.district && r.district.toLowerCase() === queryLower);
      if (!matches.length) {
        matches = allResorts.filter((r) => r.district && r.district.toLowerCase().includes(queryLower));
      }
      if (!matches.length) {
        return { ok: false, error: 'Couldn\'t find a property or area matching "' + query + '" in the resort list.', status: 404 };
      }

      // StockNetwork lists the same physical resort under multiple
      // SiteIDs — dedupe by ResortID so an area draft draws on distinct
      // properties, not the same one three times.
      const seenResortIds = new Set();
      const distinct = [];
      for (const r of matches) {
        if (!r.resortId || seenResortIds.has(r.resortId)) continue;
        seenResortIds.add(r.resortId);
        distinct.push(r);
        if (distinct.length >= 5) break;
      }

      const fetched = await Promise.all(distinct.map((r) => fetchResortInfo(r.resortId, r.siteId)));
      sources = fetched.filter(Boolean);
      if (!sources.length) {
        return { ok: false, error: "Couldn't load property info for that area right now. Try again shortly.", status: 502 };
      }
    }
  }

  const caption = await draftHookCaption({ mode: mode, label: label, sources: sources });
  const hashtags = caption ? await generateHashtags(caption) : null;

  const photos = [];
  outer: for (const s of sources) {
    for (const url of s.images) {
      if (!photos.includes(url)) photos.push(url);
      if (photos.length >= 12) break outer;
    }
  }

  // Dates default to one month out for a one-night stay — a viewer picks
  // their own dates on the landing page before booking; this is only the
  // fallback if they don't.
  const today = new Date();
  const checkIn = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()));
  const checkOut = new Date(checkIn.getTime() + 86400000);
  const fmtDate = (d) => d.toISOString().slice(0, 10);
  const bookingParams = new URLSearchParams({
    CheckInDT: fmtDate(checkIn),
    CheckOutDT: fmtDate(checkOut),
    Filter: label,
  });
  const booking = "https://stock.stocknetwork.co.za/ui/" + encodeURIComponent(bookingSiteGuid) + "?" + bookingParams.toString();

  const description = sources.map((s) => s.description).filter(Boolean).join(" ");
  const attractions = sources.map((s) => s.attractions).filter(Boolean).join(" ");
  const roomType = sources.length === 1 ? sources[0].roomType || "" : "";
  const sourceNames = sources.map((s) => s.name).filter(Boolean);

  return {
    ok: true,
    mode: mode,
    label: label,
    caption: caption || "",
    captionGenerated: !!caption,
    hashtags: hashtags,
    booking: booking,
    photos: photos,
    sourceCount: sources.length,
    sourceNames: sourceNames,
    description: description,
    attractions: attractions,
    roomType: roomType,
  };
}
