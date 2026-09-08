// Shared by hook-api.js (guarding a self-managed hook's booking link at
// save time) and admin-api.js's fixMisattributedHookLinks (cleaning up
// ones that already got saved wrong) — one definition of what counts as
// a StockNetwork booking link's site identifier and how to correct it,
// so the two can't drift apart on what they consider "confidently
// recognizable".
const STOCKNETWORK_HOST = "stock.stocknetwork.co.za";

// Jean's own real StockNetwork site GUID — confirmed directly by opening
// https://stock.stocknetwork.co.za/ui/<this> and seeing it load his actual
// site. Used as the placeholder site identifier admin default hooks are
// built with, so hook-api.js's personalizeStockNetworkUrl can recognize
// "nobody has customized this yet" and swap in whichever affiliate is
// actually viewing it — the same real-GUID identifier self-managed hooks
// already use directly (see the "Add Affiliate" modal, which requires an
// affiliate's own ID to match their real Hub/StockNetwork ID exactly).
// NOT the same thing as the numeric StockNetwork "Site Nr" ("36") used
// elsewhere for CSV/leaderboard matching only (see
// LEADERBOARD_EXCLUDED_SITE_NRS in booking-stats.js) — that number is only
// meaningful in StockNetwork's own report exports, and confirmed NOT to
// work as a /ui/<id> URL segment (a literal "Affiliate 36" link does not
// open site 36 — only the real GUID does). Kept here so admin-api.js and
// hook-api.js can't drift on which value this is.
export const ADMIN_MASTER_SITE_GUID = "c2fef00f-7330-4eb3-b993-f5f43fc73dff";

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
