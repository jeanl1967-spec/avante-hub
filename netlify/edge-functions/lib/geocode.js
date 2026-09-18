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
// Returns null on any failure (bad key, zero results, network error, rate
// limit, or a slow response — see the timeout below) rather than throwing —
// callers treat a null the same as "couldn't geocode this one, leave it for
// a retry" and move on to the rest of the batch instead of failing the
// whole request.
//
// A per-call timeout matters here specifically because this runs inside a
// batch of concurrent lookups on a Netlify Edge Function, which has its own
// execution time limit. Without it, one slow or hung Google response could
// stall its whole batch until the *function itself* got killed — producing
// a non-JSON error response that the admin UI can't parse, which is what
// caused the generic "Could not geocode." message instead of a real error.
const FETCH_TIMEOUT_MS = 8000;

export async function reverseGeocode(lat, lng, apiKey) {
  if (!apiKey) return null;
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
    return null;
  }
  if (!res.ok) return null;

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return null;
  }
  if (!data || data.status !== "OK" || !Array.isArray(data.results) || !data.results.length) {
    return null;
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
    country: find("country"),
    province: find("administrative_area_level_1"),
    town: find("locality", "postal_town", "administrative_area_level_2"),
    suburb: find("sublocality", "sublocality_level_1", "neighborhood"),
  };
}
