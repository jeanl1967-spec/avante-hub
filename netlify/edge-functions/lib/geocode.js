// Turns a lat/long into the four levels of the location tree (Country is a
// fixed display label, never geocoded) using Google's Geocoding API. Shared
// by map-api.js's geocodeLocations action — the only place that calls it.
//
// Google returns several `results[]` entries for one coordinate, each a
// different precision level (street address, then broader areas) of the
// SAME location — results[0] (the most specific match) carries the full
// administrative hierarchy in its own address_components, so there's no
// need to merge across entries.
//
// Returns { ok: true, country, province, town, suburb } on success, or
// { ok: false, reason, message } on any failure — bad key, zero results,
// network error, rate limit, or a slow response (see the timeout below).
// `reason` is Google's own status string (e.g. "REQUEST_DENIED",
// "OVER_QUERY_LIMIT", "ZERO_RESULTS") when Google actually responded, or
// "network"/"timeout"/"bad_response" when it didn't. Callers move on to the
// rest of the batch on any failure rather than stopping — but they also
// surface `reason`/`message` back to the admin UI, because "every single
// coordinate failed" almost always means a Google Cloud setup problem (API
// not enabled, billing not enabled, or an API-key restriction blocking
// server-side calls) rather than anything wrong with the coordinates
// themselves, and that's undiagnosable from a silent null.
//
// A per-call timeout matters here specifically because this runs inside a
// batch of concurrent lookups on a Netlify Edge Function, which has its own
// execution time limit. Without it, one slow or hung Google response could
// stall its whole batch until the *function itself* got killed — producing
// a non-JSON error response that the admin UI can't parse, which is what
// caused the generic "Could not geocode." message instead of a real error.
const FETCH_TIMEOUT_MS = 8000;

export async function reverseGeocode(lat, lng, apiKey) {
  if (!apiKey) return { ok: false, reason: "no_api_key", message: "" };
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?latlng=" +
    encodeURIComponent(lat) + "," + encodeURIComponent(lng) +
    "&key=" + encodeURIComponent(apiKey);

  let res;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const timedOut = e && (e.name === "AbortError");
    return { ok: false, reason: timedOut ? "timeout" : "network", message: String((e && e.message) || e) };
  }
  if (!res.ok) return { ok: false, reason: "bad_response", message: "HTTP " + res.status };

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, reason: "bad_response", message: "Response wasn't valid JSON" };
  }
  if (!data || data.status !== "OK" || !Array.isArray(data.results) || !data.results.length) {
    return {
      ok: false,
      reason: (data && data.status) || "unknown",
      message: (data && data.error_message) || "",
    };
  }

  const comps = data.results[0].address_components || [];
  function find(...types) {
    for (const type of types) {
      const c = comps.find((c) => Array.isArray(c.types) && c.types.includes(type));
      if (c) return c.long_name || "";
    }
    return "";
  }

  return {
    ok: true,
    country: find("country"),
    province: find("administrative_area_level_1"),
    town: find("locality", "postal_town", "administrative_area_level_2"),
    suburb: find("sublocality", "sublocality_level_1", "neighborhood"),
  };
}
