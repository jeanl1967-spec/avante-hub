// Straight-line (haversine) distance between two coordinates, used to match
// a hook's property to nearby Map & Activities entries for the landing page
// feature (2026-09-23) — real geometry computed from real lat/long already
// on both sides, instead of Jean typing a distance or drive time by hand.
// No existing haversine utility was found anywhere else in this codebase
// (lib/geocode.js only ever resolves an address to a coordinate, never
// compares two), so this is a new, small, dependency-free helper.
//
// Deliberately straight-line, not driving distance/time: an actual route
// would need a paid directions API call per property/activity pair, and
// nothing in this codebase calls one today. A "~x km away" figure is
// useful and honest on its own — it's never presented as a drive time.

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Returns the great-circle distance in kilometres between two points, or
// null if either coordinate is missing/invalid — callers treat null as
// "distance unknown", never as 0 (which would wrongly sort an activity
// with no coordinates as the closest one).
export function haversineKm(lat1, lng1, lat2, lng2) {
  const a1 = parseFloat(lat1);
  const o1 = parseFloat(lng1);
  const a2 = parseFloat(lat2);
  const o2 = parseFloat(lng2);
  if (![a1, o1, a2, o2].every((n) => isFinite(n))) return null;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

// One decimal place is honest for a straight-line estimate (anything more
// precise would overstate accuracy a viewer might mistake for a route).
export function formatKm(km) {
  if (km === null || km === undefined || !isFinite(km)) return "";
  if (km < 1) return Math.round(km * 1000) + " m away";
  return (Math.round(km * 10) / 10) + " km away";
}

// Given an origin point and a list of records that each carry
// latitude/longitude (activities, or any similarly-shaped record), returns
// them sorted nearest-first with a `distanceKm` field attached — records
// with no usable coordinates are dropped, never guessed into the list.
// `limit` caps the result (default: no cap); `maxKm` optionally excludes
// anything farther than that.
export function nearestByDistance(originLat, originLng, records, opts) {
  const options = opts || {};
  const withDistance = (Array.isArray(records) ? records : [])
    .filter(Boolean)
    .map((r) => ({ record: r, distanceKm: haversineKm(originLat, originLng, r.latitude, r.longitude) }))
    .filter((r) => r.distanceKm !== null);
  withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
  const filtered = typeof options.maxKm === "number" ? withDistance.filter((r) => r.distanceKm <= options.maxKm) : withDistance;
  const limited = typeof options.limit === "number" ? filtered.slice(0, options.limit) : filtered;
  return limited.map((r) => Object.assign({}, r.record, { distanceKm: r.distanceKm, distanceLabel: formatKm(r.distanceKm) }));
}
