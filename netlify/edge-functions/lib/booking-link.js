// Shared by hook-api.js (guarding a self-managed hook's booking link at
// save time) and admin-api.js's fixMisattributedHookLinks (cleaning up
// ones that already got saved wrong) — one definition of what counts as
// a StockNetwork booking link's site identifier and how to correct it,
// so the two can't drift apart on what they consider "confidently
// recognizable".
const STOCKNETWORK_HOST = "stock.stocknetwork.co.za";

// A StockNetwork booking link's site identifier is the "<id>" in
// ".../ui/<id>" — the one exact shape every booking-link builder in this
// codebase produces (see STOCKNETWORK_BASE in admin.html/hub.html/
// landing.html). Leaves rawUrl completely unchanged (changed: false) if
// it isn't that exact host+shape, if the id already matches
// expectedSiteId, or if anything about it can't be confidently parsed —
// we only ever touch a link we're sure we understand, the same
// philosophy personalizeStockNetworkUrl (in hook-api.js) already follows
// for the admin-managed "Affiliate <N>" case. previousSiteId is only
// meaningful when changed is true — callers that just want the
// corrected link (not caring what it was) can ignore it.
export function correctBookingLinkSiteId(rawUrl, expectedSiteId) {
  const unchanged = { url: rawUrl, changed: false, previousSiteId: null };
  if (!rawUrl || !expectedSiteId) return unchanged;
  let u;
  try {
    u = new URL(rawUrl);
  } catch (e) {
    return unchanged;
  }
  if (u.hostname !== STOCKNETWORK_HOST) return unchanged;

  const segments = u.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== "ui") return unchanged;
  let seg;
  try {
    seg = decodeURIComponent(segments[1]);
  } catch (e) {
    return unchanged;
  }
  if (!seg || seg === expectedSiteId) return unchanged;

  u.pathname = "/ui/" + encodeURIComponent(expectedSiteId);
  return { url: u.toString(), changed: true, previousSiteId: seg };
}
