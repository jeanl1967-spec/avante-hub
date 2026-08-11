import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

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
      if (body.mode === "self" || body.mode === "admin") record.mode = body.mode;
      if (!record.mode) record.mode = "admin"; // default per hook, per spec

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
      // The admin's own default record — no resolution needed, just return it.
      const data = affRecord ? { ...affRecord } : null;
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (source === "admin") {
      const adminRecord = await store.get(ADMIN_KEY + ":" + hook, { type: "json" });
      const data = adminRecord
        ? { booking: adminRecord.booking || "", landing: adminRecord.landing || "", mode: mode, source: "admin", expired: expired }
        : { mode: mode, source: "admin", expired: expired };
      // If there's genuinely nothing to show (no admin default set either),
      // return null so callers treat this hook slot as inactive — same as
      // the old behaviour for an empty hook.
      const hasContent = adminRecord && (adminRecord.booking || adminRecord.landing);
      return new Response(JSON.stringify(hasContent ? data : null), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    // source === "self"
    const data = affRecord
      ? { booking: affRecord.booking || "", landing: affRecord.landing || "", mode: mode, source: "self", expired: expired }
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
