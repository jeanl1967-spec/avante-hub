// Shared by hook-api.js's GET (the source of truth for what an affiliate's
// storefront actually shows) and admin-api.js's generateShortCodes (which
// needs to know, ahead of time, whether a given affiliate+hook currently
// has anything worth a short code) — one definition of how a hook's mode
// resolves into what should actually be shown, so the two can't drift.

// Pull the CheckInDT=YYYY-MM-DD date off a booking link built by the
// Accommodation Link Builder, if present. Links pasted in by hand (or built
// from other tools) may not have one at all — that's fine, it just means
// there's nothing to expire.
export function parseCheckInDate(bookingUrl) {
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

export function todayUTCDateOnly() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Resolves a hook's actual serving mode/source/expired state from its own
// record (the "<affId>:<n>" record — the admin's own "__admin__:<n>"
// record has no mode/expiry concept and never goes through this). `mode`
// reflects what the affiliate has explicitly chosen (defaulting to
// "admin" if never set); `source` is what should actually be shown right
// now — a self-managed hook whose booking link's CheckInDT has passed
// falls back to the shared admin default (source: "admin") even though
// its stored `mode` still says "self", so callers that care about what's
// really being served must use `source`, not `mode`.
export function resolveHookMode(ownRecord) {
  const mode = (ownRecord && ownRecord.mode) === "self" ? "self" : "admin";
  let source = mode;
  let expired = false;

  if (mode === "self") {
    const checkIn = parseCheckInDate(ownRecord && ownRecord.booking);
    if (checkIn && todayUTCDateOnly() >= checkIn) {
      source = "admin";
      expired = true;
    }
  }

  return { mode, source, expired };
}
