// A stable identity for one row in the resort-list store (the ~5,900-row
// StockNetwork property master, imported wholesale by resorts-api.js).
//
// StockNetwork's own ResortID identifies the physical property; the same
// ResortID can appear under more than one SiteID (StockNetwork lists the
// same resort under multiple booking "sites"), so the pair is what actually
// identifies one listed row — matching resorts-api.js's own within-import
// de-duplication, which already keys on name+siteId+resortId.
//
// Used in two places that both need the SAME row to resolve to the SAME key
// across a fresh CSV re-import: resorts-api.js's mergeResorts (so an
// admin-assigned affId survives the next StockNetwork upload instead of
// being wiped by the wholesale-replace) and admin-api.js's setResortAffId
// (so the checkboxes the admin ticked in the location tree — which read
// this same key from each property's data-key attribute — match back to
// the right row when the assignment is saved).
//
// Returns "" for a row with no resortId at all (can't be matched reliably
// across imports — rare; resorts-api.js's parser falls back to the CSV's
// last two columns for resortId/siteId, so this should only happen on a
// malformed export). Callers must treat "" as "not matchable", never as a
// real shared key.
export function resortKey(r) {
  const resortId = (r && r.resortId) || "";
  if (!resortId) return "";
  const siteId = (r && r.siteId) || "";
  return resortId + "|" + siteId;
}

// Carries an existing row's admin-set fields (currently just affId) forward
// onto the freshly-parsed row with the same resortKey, so a StockNetwork
// CSV re-import updates each property's own listing details (name,
// district, suburb, zoneHint, lat/lng — all authoritative from the new
// file) without silently wiping which affiliate it was assigned to. A
// property that no longer appears in the new file simply drops out (and
// its old affId with it) — same as any other row that's gone from the new
// list. A brand-new property not seen before just gets the default "".
export function mergeResorts(oldResorts, newResorts) {
  const oldByKey = new Map();
  for (const r of Array.isArray(oldResorts) ? oldResorts : []) {
    const key = resortKey(r);
    if (key && !oldByKey.has(key)) oldByKey.set(key, r);
  }
  return (Array.isArray(newResorts) ? newResorts : []).map((r) => {
    const key = resortKey(r);
    const old = key ? oldByKey.get(key) : null;
    return { ...r, affId: old && typeof old.affId === "string" ? old.affId : "" };
  });
}
