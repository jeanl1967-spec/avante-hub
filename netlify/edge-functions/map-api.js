import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";
import { ZONES, provinceToZone, districtToZone } from "./lib/zones.js";

// Backs the new "Map & Activities" admin tab and the new "Explore Map" hub
// tab. Two data sources feed one shared response:
//
// 1. Properties — read directly from the existing `property-listings` store
//    (property-onboarding-api.js). Any listing with status "Listed" and a
//    latitude/longitude already on file becomes a map pin — no new property
//    data entry required. This file only READS that store; it never writes
//    to it, so property-onboarding-api.js and its admin tab are untouched.
// 2. Activities — a new `map-activities` store, since excursions/experiences
//    don't exist anywhere else in the system yet. Admin-managed here.
//
// A third store, `map-visibility`, holds a simple hide/show flag per
// property listingId so an admin can pull a property off the map without
// touching its underlying listing record.
//
// GET is public (no token) and returns only what the Hub map should show:
// Listed + visible properties, and visible activities.
// POST actions are admin-only (same admin-sessions token check used by
// property-onboarding-api.js) and cover activity CRUD plus the property
// visibility toggle, and an "adminList" action that returns everything
// (including hidden) for the admin tab's own view.
//
// Zones (ZONES / provinceToZone) live in lib/zones.js, shared with
// admin-api.js's affiliate Zone field — see that file for details.

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 500) : "";
}

// Minimal CSV field-splitter (handles quoted fields, embedded commas, and
// "" escaped quotes) — same approach as resorts-api.js's parseCsvLine,
// duplicated locally rather than shared since it's a few lines and this
// file shouldn't import from another routed function.
function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { result.push(cur); cur = ""; }
      else { cur += ch; }
    }
  }
  result.push(cur);
  return result;
}

function parseActivitiesCsv(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const cols = {
    id: idx("id"),
    name: idx("name"),
    area: idx("area"),
    zone: idx("zone"),
    price: idx("price"),
    contactLink: idx("contactlink"),
    description: idx("description"),
    latitude: idx("latitude"),
    longitude: idx("longitude"),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const get = (key) => (cols[key] > -1 ? (fields[cols[key]] || "").trim() : "");
    const name = get("name");
    if (!name) continue;
    rows.push({
      id: get("id"),
      name: name,
      area: get("area"),
      zone: get("zone"),
      price: get("price"),
      contactLink: get("contactLink"),
      description: get("description"),
      latitude: get("latitude"),
      longitude: get("longitude"),
    });
  }
  return rows;
}

function genActivityId() {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return "A-" + n;
}

// Runs `fn` over `items` with at most `limit` calls in flight at once.
// Needed anywhere we touch a growing number of blobs at once (e.g.
// re-reading every existing activity during a bulk import) — firing them
// all off via a single unbounded Promise.all() works fine while the store
// is small, but as the activity count grows into the hundreds, blasting
// that many concurrent blob reads/writes from one function invocation
// risks exhausting connections and crashing with a 502, well before any
// per-request time limit would ever be hit.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function verifyAdminToken(token) {
  if (!token) return false;
  const sessionStore = getStore({ name: "admin-sessions", consistency: "strong" });
  const session = await sessionStore.get(token, { type: "json" });
  if (!session) return false;
  if (new Date(session.expiresAt).getTime() < Date.now()) return false;
  return true;
}

function coverImageUrl(images) {
  if (!Array.isArray(images) || !images.length) return "";
  const cover = images.find((i) => i && i.cover === "Y") || images[0];
  return cover && cover.key ? "/api/property-file?key=" + encodeURIComponent(cover.key) : "";
}

function toPropertyPin(record, hidden) {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  return {
    kind: "property",
    listingId: record.listingId,
    source: "onboarded",
    name: record.propertyName || "",
    area: record.area || record.district || "",
    city: record.city || "",
    country: record.country || "",
    zone: provinceToZone(record.stateProvince),
    description: (record.description || "").slice(0, 400),
    latitude: lat,
    longitude: lng,
    infoLink: record.infoLink || "",
    bookingLink: record.bookingLink || "",
    photo: coverImageUrl(record.images),
    hidden: !!hidden,
  };
}

// StockNetwork's own resort list is a much bigger dataset (thousands of
// properties) than the hand-onboarded property-listings above — it's the
// full inventory, kept up to date by re-uploading a CSV from StockNetwork
// via the existing /api/resorts endpoint (see resorts-api.js). Most rows
// won't have Latitude/Longitude unless that CSV export includes them, so
// only ones that do become pins here — same "skip if no usable
// coordinates" rule as onboarded properties. listingId is synthetic
// (resort:<resortId>:<siteId>) so a resort pin can still be individually
// hidden via the same map-visibility store as everything else, even
// though there's no per-row edit UI for this dataset (updates happen by
// re-uploading the whole CSV, not one row at a time).
function resortPinId(record) {
  return "resort:" + (record.resortId || "") + ":" + (record.siteId || "");
}

function toResortPin(record, hidden) {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return null;
  const infoLink = record.resortId
    ? "https://old.stocknetwork.co.za/ResortInfo.aspx?ResortID=" +
      encodeURIComponent(record.resortId) +
      (record.siteId ? "&SiteID=" + encodeURIComponent(record.siteId) : "")
    : "";
  return {
    kind: "property",
    listingId: resortPinId(record),
    source: "resort-list",
    name: record.name || "",
    area: record.district || "",
    city: "",
    country: "South Africa",
    zone: districtToZone(record.district),
    description: "",
    latitude: lat,
    longitude: lng,
    infoLink: infoLink,
    bookingLink: "",
    photo: "",
    hidden: !!hidden,
  };
}

function sanitizeActivity(body, existing) {
  const record = existing ? Object.assign({}, existing) : {};
  const fields = ["name", "area", "description", "price", "contactLink"];
  fields.forEach((f) => {
    if (typeof body[f] === "string") {
      record[f] = clean(body[f], f === "description" ? 2000 : 300);
    }
  });
  if (typeof body.zone === "string") {
    record.zone = ZONES.includes(body.zone) ? body.zone : "";
  }
  if (typeof body.latitude === "string" || typeof body.latitude === "number") {
    const lat = parseFloat(body.latitude);
    record.latitude = isFinite(lat) ? String(lat) : "";
  }
  if (typeof body.longitude === "string" || typeof body.longitude === "number") {
    const lng = parseFloat(body.longitude);
    record.longitude = isFinite(lng) ? String(lng) : "";
  }
  if (typeof body.visible === "boolean") record.visible = body.visible;
  if (record.visible === undefined) record.visible = true;
  return record;
}

function toActivityPin(record) {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  const keys = Array.isArray(record.photoKeys) ? record.photoKeys : record.photoKey ? [record.photoKey] : [];
  const photos = keys.map((k) => "/api/property-file?key=" + encodeURIComponent(k));
  return {
    kind: "activity",
    id: record.id,
    name: record.name || "",
    area: record.area || "",
    zone: record.zone || "",
    description: (record.description || "").slice(0, 400),
    price: record.price || "",
    contactLink: record.contactLink || "",
    photo: photos[0] || "",
    photos: photos,
    latitude: isFinite(lat) ? lat : null,
    longitude: isFinite(lng) ? lng : null,
    hidden: record.visible === false,
  };
}

function parseCoordinatesCsv(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const cols = {
    id: idx("id"),
    propertyName: idx("propertyname"),
    latitude: idx("latitude"),
    longitude: idx("longitude"),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const get = (key) => (cols[key] > -1 ? (fields[cols[key]] || "").trim() : "");
    const id = get("id");
    const propertyName = get("propertyName");
    const latitude = get("latitude");
    const longitude = get("longitude");
    if (!id && !propertyName) continue;
    if (!latitude || !longitude) continue;
    rows.push({ id, propertyName, latitude, longitude });
  }
  return rows;
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

  const json = (data, status) =>
    new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { "content-type": "application/json", ...cors },
    });

  const listingsStore = getStore({ name: "property-listings", consistency: "strong" });
  const activitiesStore = getStore({ name: "map-activities", consistency: "strong" });
  const visibilityStore = getStore({ name: "map-visibility", consistency: "strong" });
  const resortListStore = getStore({ name: "resort-list", consistency: "strong" });

  try {
    if (request.method === "GET") {
      const { blobs } = await listingsStore.list();
      const listings = await mapWithConcurrency(blobs, 25, (b) => listingsStore.get(b.key, { type: "json" }));
      const { blobs: visBlobs } = await visibilityStore.list();
      const visFlags = await mapWithConcurrency(visBlobs, 25, (b) => visibilityStore.get(b.key, { type: "json" }));
      const hiddenIds = new Set(
        visBlobs.filter((b, i) => visFlags[i] && visFlags[i].hidden).map((b) => b.key)
      );

      const onboardedProperties = listings
        .filter((r) => r && r.status === "Listed")
        .filter((r) => !hiddenIds.has(r.listingId))
        .map((r) => toPropertyPin(r, false))
        .filter(Boolean);

      const resortRecord = await resortListStore.get("current", { type: "json" });
      const resortList = (resortRecord && Array.isArray(resortRecord.resorts)) ? resortRecord.resorts : [];
      const resortProperties = resortList
        .filter((r) => !hiddenIds.has(resortPinId(r)))
        .map((r) => toResortPin(r, false))
        .filter(Boolean);

      const properties = onboardedProperties.concat(resortProperties);

      const { blobs: actBlobs } = await activitiesStore.list();
      const activities = (await mapWithConcurrency(actBlobs, 25, (b) => activitiesStore.get(b.key, { type: "json" })))
        .filter((r) => r && r.visible !== false)
        .map(toActivityPin);

      return json({ ok: true, properties, activities });
    }

    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "invalid JSON" }, 400);
    }

    const authed = await verifyAdminToken(body.token);
    if (!authed) return json({ error: "Not authenticated." }, 401);

    const action = body.action;

    if (action === "adminList") {
      const { blobs } = await listingsStore.list();
      const listings = await mapWithConcurrency(blobs, 25, (b) => listingsStore.get(b.key, { type: "json" }));
      const { blobs: visBlobs } = await visibilityStore.list();
      const visRecords = await mapWithConcurrency(visBlobs, 25, (b) => visibilityStore.get(b.key, { type: "json" }));
      const hiddenIds = new Set(visBlobs.filter((b, i) => visRecords[i] && visRecords[i].hidden).map((b) => b.key));

      const listedListings = listings.filter((r) => r && r.status === "Listed");
      const onboardedProperties = listedListings.map((r) => toPropertyPin(r, hiddenIds.has(r.listingId))).filter(Boolean);

      // Listed properties with no usable coordinates never become a pin, so
      // they're surfaced here separately — the admin tab uses this to show
      // which ones still need a latitude/longitude, e.g. via the
      // importPropertyCoordinatesCsv action below.
      const missingCoordinates = listedListings
        .filter((r) => {
          const lat = parseFloat(r.latitude);
          const lng = parseFloat(r.longitude);
          return !isFinite(lat) || !isFinite(lng);
        })
        .map((r) => ({
          listingId: r.listingId,
          propertyName: r.propertyName || "",
          city: r.city || "",
          country: r.country || "",
        }));

      const resortRecord = await resortListStore.get("current", { type: "json" });
      const resortList = (resortRecord && Array.isArray(resortRecord.resorts)) ? resortRecord.resorts : [];
      const resortProperties = resortList
        .map((r) => toResortPin(r, hiddenIds.has(resortPinId(r))))
        .filter(Boolean);
      const resortStats = {
        total: resortList.length,
        withCoordinates: resortProperties.length,
        updatedAt: (resortRecord && resortRecord.updatedAt) || null,
      };

      const properties = onboardedProperties.concat(resortProperties);

      const { blobs: actBlobs } = await activitiesStore.list();
      const activities = await mapWithConcurrency(actBlobs, 25, (b) => activitiesStore.get(b.key, { type: "json" }));

      return json({ ok: true, properties, activities: activities.filter(Boolean), missingCoordinates, resortStats });
    }

    if (action === "importPropertyCoordinatesCsv") {
      // The only place this file ever writes to property-listings, and only
      // ever these two fields — everything else about a listing (status,
      // agreement, owner details, etc.) stays exactly as
      // property-onboarding-api.js / the Property Listings tab left it.
      const csvText = typeof body.csv === "string" ? body.csv : "";
      if (!csvText.trim()) return json({ error: "Uploaded file was empty." }, 400);
      const rows = parseCoordinatesCsv(csvText);
      if (!rows.length) {
        return json({ error: "Could not find any usable rows (need an id or propertyName column, plus latitude and longitude)." }, 400);
      }

      const { blobs } = await listingsStore.list();
      const listings = await mapWithConcurrency(blobs, 25, (b) => listingsStore.get(b.key, { type: "json" }));
      const listed = listings.filter((r) => r && r.status === "Listed");
      const byId = new Map(listed.map((r) => [r.listingId, r]));

      let updated = 0;
      let skippedNoMatch = 0;
      let skippedAmbiguous = 0;
      for (const row of rows) {
        const lat = parseFloat(row.latitude);
        const lng = parseFloat(row.longitude);
        if (!isFinite(lat) || !isFinite(lng)) { skippedNoMatch++; continue; }

        let match = row.id ? byId.get(row.id) : null;
        if (!match && row.propertyName) {
          const nameMatches = listed.filter((r) => (r.propertyName || "").toLowerCase() === row.propertyName.toLowerCase());
          if (nameMatches.length === 1) match = nameMatches[0];
          else if (nameMatches.length > 1) { skippedAmbiguous++; continue; }
        }
        if (!match) { skippedNoMatch++; continue; }

        match.latitude = String(lat);
        match.longitude = String(lng);
        match.dateUpdated = new Date().toISOString();
        await listingsStore.setJSON(match.listingId, match);
        updated++;
      }

      return json({ ok: true, updated, skippedNoMatch, skippedAmbiguous });
    }

    if (action === "importActivitiesCsv") {
      const csvText = typeof body.csv === "string" ? body.csv : "";
      if (!csvText.trim()) return json({ error: "Uploaded file was empty." }, 400);
      const rows = parseActivitiesCsv(csvText);
      if (!rows.length) return json({ error: "Could not find any activity rows (need at least a 'name' column)." }, 400);

      // Bounded to 25 concurrent reads — see mapWithConcurrency above for
      // why this can't be a plain Promise.all once the store has grown.
      const { blobs: existingBlobs } = await activitiesStore.list();
      const existingRecords = await mapWithConcurrency(existingBlobs, 25, (b) =>
        activitiesStore.get(b.key, { type: "json" })
      );
      const byId = new Map(existingRecords.filter(Boolean).map((r) => [r.id, r]));
      const byName = new Map(existingRecords.filter(Boolean).map((r) => [(r.name || "").toLowerCase(), r]));

      let created = 0;
      let updated = 0;
      await mapWithConcurrency(rows, 10, async (row) => {
        const matchExisting = (row.id && byId.get(row.id)) || byName.get(row.name.toLowerCase());
        const record = sanitizeActivity(row, matchExisting || {});
        if (matchExisting) {
          record.id = matchExisting.id;
          record.updatedAt = new Date().toISOString();
          updated++;
        } else {
          record.id = genActivityId();
          record.createdAt = new Date().toISOString();
          record.updatedAt = record.createdAt;
          created++;
        }
        await activitiesStore.setJSON(record.id, record);
      });

      return json({ ok: true, created: created, updated: updated });
    }

    if (action === "addActivity") {
      const id = genActivityId();
      const record = sanitizeActivity(body, {});
      record.id = id;
      record.createdAt = new Date().toISOString();
      record.updatedAt = record.createdAt;
      if (!record.name) return json({ error: "Activity name is required." }, 400);
      await activitiesStore.setJSON(id, record);
      return json({ ok: true, activity: record });
    }

    if (action === "updateActivity") {
      const id = clean(body.id, 20);
      if (!id) return json({ error: "missing id" }, 400);
      const existing = await activitiesStore.get(id, { type: "json" });
      if (!existing) return json({ error: "not found" }, 404);
      const record = sanitizeActivity(body, existing);
      record.updatedAt = new Date().toISOString();
      await activitiesStore.setJSON(id, record);
      return json({ ok: true, activity: record });
    }

    if (action === "deleteActivity") {
      const id = clean(body.id, 20);
      if (!id) return json({ error: "missing id" }, 400);
      await activitiesStore.delete(id);
      return json({ ok: true });
    }

    if (action === "addActivityPhoto") {
      const id = clean(body.id, 20);
      const photoKey = clean(body.photoKey, 300);
      if (!id || !photoKey) return json({ error: "missing id or photoKey" }, 400);
      const existing = await activitiesStore.get(id, { type: "json" });
      if (!existing) return json({ error: "not found" }, 404);
      const keys = Array.isArray(existing.photoKeys) ? existing.photoKeys.slice() : existing.photoKey ? [existing.photoKey] : [];
      if (keys.length >= 12) return json({ error: "Maximum 12 photos per activity." }, 400);
      keys.push(photoKey);
      existing.photoKeys = keys;
      delete existing.photoKey;
      existing.updatedAt = new Date().toISOString();
      await activitiesStore.setJSON(id, existing);
      return json({ ok: true, activity: existing });
    }

    if (action === "removeActivityPhoto") {
      const id = clean(body.id, 20);
      const photoKey = clean(body.photoKey, 300);
      if (!id || !photoKey) return json({ error: "missing id or photoKey" }, 400);
      const existing = await activitiesStore.get(id, { type: "json" });
      if (!existing) return json({ error: "not found" }, 404);
      const keys = Array.isArray(existing.photoKeys) ? existing.photoKeys.slice() : existing.photoKey ? [existing.photoKey] : [];
      existing.photoKeys = keys.filter((k) => k !== photoKey);
      delete existing.photoKey;
      existing.updatedAt = new Date().toISOString();
      await activitiesStore.setJSON(id, existing);
      return json({ ok: true, activity: existing });
    }

    if (action === "setPropertyVisibility") {
      const listingId = clean(body.listingId, 20);
      const hidden = body.hidden === true;
      if (!listingId) return json({ error: "missing listingId" }, 400);
      if (hidden) {
        await visibilityStore.setJSON(listingId, { hidden: true });
      } else {
        await visibilityStore.delete(listingId);
      }
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
};

export const config = { path: "/api/map" };
