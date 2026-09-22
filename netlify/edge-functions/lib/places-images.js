// Fetches real, place-tagged photos from Google's Places API (legacy Text
// Search + Place Photo endpoints) for the two things Event hooks need: a
// location/area photo (query = the event's location name) and a "theme"
// photo (query = the event's theme, e.g. "whale watching") — see
// admin-api.js's findPlaceImages action, which is the only caller.
//
// Jean explicitly chose Google Places API for both of these over
// Pexels/Unsplash (this project's own earlier recommendation — see
// event-hook-image-picker-spec.md) despite the caveat that Places' photo
// terms are stricter and that free-text theme search isn't really what
// Places Text Search is built for (it searches "places", so a query like
// "whale watching" tends to surface tour operators/businesses rather than
// generic themed scenery — the admin can always retype a more specific
// query; see admin.html's picker). That's a settled decision, not a bug
// to fix here.
//
// This module NEVER returns a Google Places photo URL to the caller —
// those embed the API key as a query param, which would otherwise leak
// into places a client (or, worse, stored blob metadata — see
// lib/hook-photos.js's sourceUrl field) can see. Instead it fetches the
// actual image bytes itself, server-side, and hands back data: URIs (see
// lib/data-uri.js) — the key never leaves this file.
import { bytesToDataUri } from "./data-uri.js";
import { mapWithConcurrency } from "./booking-stats.js";

// Same reasoning as lib/geocode.js's FETCH_TIMEOUT_MS: this can run inside
// a Netlify Edge Function with its own execution limit, and a hung Google
// response must not be allowed to stall past that.
const FETCH_TIMEOUT_MS = 8000;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Returns, on success:
//   { ok: true, place: { name, formattedAddress }, images: [{ dataUri, width, height, attribution }] }
// On failure:
//   { ok: false, reason, message }
// `reason` is Google's own status string (e.g. "ZERO_RESULTS",
// "REQUEST_DENIED", "OVER_QUERY_LIMIT") when Google actually responded, or
// one of "no_api_key" / "empty_query" / "network" / "timeout" /
// "bad_response" / "no_photos" / "photo_fetch_failed" otherwise — same
// shape as lib/geocode.js's reverseGeocode, for the same reason: "every
// search fails" almost always means a Google Cloud setup problem (API not
// enabled, billing not enabled, or a key restriction blocking server-side
// calls), and that's undiagnosable from a silent empty result.
export async function searchPlacePhotos(query, apiKey, limit) {
  const q = typeof query === "string" ? query.trim() : "";
  const cap = Math.max(1, Math.min(9, Number(limit) || 6));
  if (!apiKey) return { ok: false, reason: "no_api_key", message: "" };
  if (!q) return { ok: false, reason: "empty_query", message: "" };

  const searchUrl =
    "https://maps.googleapis.com/maps/api/place/textsearch/json?query=" +
    encodeURIComponent(q) + "&key=" + encodeURIComponent(apiKey);

  let searchRes;
  try {
    searchRes = await fetchWithTimeout(searchUrl);
  } catch (e) {
    const timedOut = e && e.name === "AbortError";
    return { ok: false, reason: timedOut ? "timeout" : "network", message: String((e && e.message) || e) };
  }
  if (!searchRes.ok) return { ok: false, reason: "bad_response", message: "HTTP " + searchRes.status };

  let searchData;
  try {
    searchData = await searchRes.json();
  } catch (e) {
    return { ok: false, reason: "bad_response", message: "Response wasn't valid JSON" };
  }
  if (!searchData || searchData.status !== "OK" || !Array.isArray(searchData.results) || !searchData.results.length) {
    return {
      ok: false,
      reason: (searchData && searchData.status) || "unknown",
      message: (searchData && searchData.error_message) || "",
    };
  }

  // Only the top match's own photos — same "results[0] carries what we
  // need, no merging across candidates" approach geocode.js takes, and
  // keeps the picker showing photos of one real place rather than a
  // grab-bag of unrelated ones sharing the search text.
  const place = searchData.results[0];
  const photos = Array.isArray(place.photos) ? place.photos.slice(0, cap) : [];
  if (!photos.length) {
    return {
      ok: false,
      reason: "no_photos",
      message: "Google found \"" + (place.name || q) + "\" but it has no photos on file.",
    };
  }

  const fetched = await mapWithConcurrency(
    photos,
    async (photo) => {
      if (!photo || !photo.photo_reference) return null;
      const photoUrl =
        "https://maps.googleapis.com/maps/api/place/photo?maxwidth=900&photoreference=" +
        encodeURIComponent(photo.photo_reference) + "&key=" + encodeURIComponent(apiKey);
      try {
        const res = await fetchWithTimeout(photoUrl);
        if (!res.ok) return null;
        const contentType = res.headers.get("content-type") || "image/jpeg";
        if (!contentType.startsWith("image/")) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 1 || buf.byteLength > MAX_PHOTO_BYTES) return null;
        const attribution =
          Array.isArray(photo.html_attributions) && photo.html_attributions.length
            ? String(photo.html_attributions[0]).replace(/<[^>]+>/g, "")
            : "Photo via Google";
        return {
          dataUri: bytesToDataUri(buf, contentType),
          width: photo.width || null,
          height: photo.height || null,
          attribution: attribution,
        };
      } catch (e) {
        return null;
      }
    },
    3
  );

  const images = fetched.filter((x) => x);
  if (!images.length) {
    return {
      ok: false,
      reason: "photo_fetch_failed",
      message: "Google found matching photos but none could be downloaded — please try again.",
    };
  }

  return {
    ok: true,
    place: { name: place.name || "", formattedAddress: place.formatted_address || "" },
    images: images,
  };
}
