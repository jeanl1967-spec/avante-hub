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

function parseTownsCsv(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const cols = {
    id: idx("id"),
    name: idx("name"),
    area: idx("area"),
    zone: idx("zone"),
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
      description: get("description"),
      latitude: get("latitude"),
      longitude: get("longitude"),
    });
  }
  return rows;
}

function genTownId() {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return "T-" + n;
}

// Suburbs — the third, finest tier under a Town (Zone > Town > Suburb).
// Stored nested inside their parent town record (town.suburbs, an array of
// {id, name, affId, latitude, longitude, visible}) rather than as their own
// collection: a suburb never exists independently of a town, so this avoids
// a second one-blob-collection store and the join it would need on every
// read. Same affId convention as towns — empty means shared/unallocated.
function genSuburbId() {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return "SB-" + n;
}

function genSuburbUniqueId(existingIds) {
  let id = genSuburbId();
  while (existingIds.has(id)) {
    id = genSuburbId();
  }
  return id;
}

function allSuburbIds(towns) {
  const ids = new Set();
  towns.forEach((t) => {
    (Array.isArray(t.suburbs) ? t.suburbs : []).forEach((s) => { if (s && s.id) ids.add(s.id); });
  });
  return ids;
}

function sanitizeSuburb(body, existing) {
  const record = existing ? Object.assign({}, existing) : {};
  if (typeof body.name === "string") record.name = clean(body.name, 300);
  if (typeof body.affId === "string") record.affId = clean(body.affId, 60);
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

function toSuburbPin(record) {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  return {
    id: record.id,
    name: record.name || "",
    affId: record.affId || "",
    latitude: isFinite(lat) ? lat : null,
    longitude: isFinite(lng) ? lng : null,
    hidden: record.visible === false,
  };
}

// Netlify Edge Functions have a very small (documented: 50ms) CPU-time
// budget per request, and — critically — Netlify Blobs' list() only ever
// returns keys, never the stored value, so reading N activities always
// costs N separate get() calls no matter how those calls are scheduled.
// Storing every activity as its own blob meant that cost grew with the
// total activity count forever, and eventually blew the CPU budget even
// for actions that only touch one activity. Storing the whole collection
// as a single JSON blob under one fixed key turns every read into exactly
// one get() and every write into exactly one setJSON(), regardless of how
// many activities exist.
const ACTIVITIES_KEY = "all";

async function loadActivities(activitiesStore) {
  const data = await activitiesStore.get(ACTIVITIES_KEY, { type: "json" });
  return Array.isArray(data) ? data : [];
}

async function saveActivities(activitiesStore, list) {
  await activitiesStore.setJSON(ACTIVITIES_KEY, list);
}

function genUniqueActivityId(existingIds) {
  let id = genActivityId();
  while (existingIds.has(id)) {
    id = genActivityId();
  }
  return id;
}

// Towns — same one-blob-collection pattern as activities above (see the
// comment on ACTIVITIES_KEY for why). A town can optionally be allocated
// to one affiliate (affId) so it's available to that affiliate's area
// hooks specifically, not just tagged with a broad zone the way
// affiliates themselves are — see sanitizeTown / toTownPin. A town with
// no affId set is treated as shared/unallocated and visible to every
// affiliate's Explore Map and area-hook picker.
const TOWNS_KEY = "all";

async function loadTowns(townsStore) {
  const data = await townsStore.get(TOWNS_KEY, { type: "json" });
  return Array.isArray(data) ? data : [];
}

async function saveTowns(townsStore, list) {
  await townsStore.setJSON(TOWNS_KEY, list);
}

function genTownUniqueId(existingIds) {
  let id = genTownId();
  while (existingIds.has(id)) {
    id = genTownId();
  }
  return id;
}

// Runs `fn` over `items` with at most `limit` calls in flight at once.
// Still used for the (small, not expected to grow into the hundreds)
// property-listings and map-visibility stores — see loadActivities above
// for why activities themselves no longer use this pattern.
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

function sanitizeTown(body, existing) {
  const record = existing ? Object.assign({}, existing) : {};
  const fields = ["name", "area", "description"];
  fields.forEach((f) => {
    if (typeof body[f] === "string") {
      record[f] = clean(body[f], f === "description" ? 2000 : 300);
    }
  });
  if (typeof body.zone === "string") {
    record.zone = ZONES.includes(body.zone) ? body.zone : "";
  }
  // affId: which affiliate this town is allocated to. Empty string means
  // shared/unallocated — every affiliate's Explore Map and area-hook
  // picker can use it. Not validated against the affiliate-profiles store
  // here (this file doesn't otherwise read that store) — an affId that no
  // longer exists just means the town quietly stops matching anyone,
  // same failure mode as a stale zone value above.
  if (typeof body.affId === "string") {
    record.affId = clean(body.affId, 60);
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

function toTownPin(record) {
  const lat = parseFloat(record.latitude);
  const lng = parseFloat(record.longitude);
  const keys = Array.isArray(record.photoKeys) ? record.photoKeys : record.photoKey ? [record.photoKey] : [];
  const photos = keys.map((k) => "/api/property-file?key=" + encodeURIComponent(k));
  const suburbs = (Array.isArray(record.suburbs) ? record.suburbs : []).map(toSuburbPin);
  return {
    kind: "town",
    id: record.id,
    name: record.name || "",
    area: record.area || "",
    zone: record.zone || "",
    affId: record.affId || "",
    description: (record.description || "").slice(0, 400),
    photo: photos[0] || "",
    photos: photos,
    latitude: isFinite(lat) ? lat : null,
    longitude: isFinite(lng) ? lng : null,
    hidden: record.visible === false,
    suburbs: suburbs,
  };
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

// Auto-discovers the Zone > Town > Suburb tree from data that already
// exists elsewhere in the system, so an admin doesn't have to type every
// town and suburb in by hand:
//  - Onboarded property-listings: city (or district) => town, area => suburb
//    (skipped when it's identical to the town name), stateProvince => zone.
//  - The full StockNetwork resort-list: district => town (no suburb-level
//    field exists on that dataset), district => zone via districtToZone.
//  - map-activities: area => town (activities don't carry a separate town
//    field, so their "area" is the finest location grouping they have),
//    zone as entered by the admin (falls back to a district-style zone
//    guess if it isn't one of the canonical ZONES).
// Coordinates for a discovered town/suburb are the average of every
// contributing record that has a usable latitude/longitude; a node with no
// such record is left with no coordinates, same as the existing
// "missing coordinates" pattern used for properties elsewhere in this file.
async function discoverLocationTree({ listingsStore, resortListStore, activitiesStore }) {
  const zones = new Map(); // zoneName -> Map(townNameLower -> townNode)

  function zoneBucket(zoneName) {
    const key = zoneName || "";
    if (!zones.has(key)) zones.set(key, new Map());
    return zones.get(key);
  }
  function townNode(bucket, name) {
    const key = name.toLowerCase();
    if (!bucket.has(key)) {
      bucket.set(key, { name, suburbs: new Map(), propertyCount: 0, activityCount: 0, latSum: 0, lngSum: 0, coordCount: 0 });
    }
    return bucket.get(key);
  }
  function suburbNode(town, name) {
    const key = name.toLowerCase();
    if (!town.suburbs.has(key)) {
      town.suburbs.set(key, { name, count: 0, latSum: 0, lngSum: 0, coordCount: 0 });
    }
    return town.suburbs.get(key);
  }
  function addCoord(node, lat, lng) {
    const la = parseFloat(lat), ln = parseFloat(lng);
    if (isFinite(la) && isFinite(ln)) { node.latSum += la; node.lngSum += ln; node.coordCount++; }
  }

  const { blobs } = await listingsStore.list();
  const listings = await mapWithConcurrency(blobs, 25, (b) => listingsStore.get(b.key, { type: "json" }));
  listings.filter(Boolean).forEach((r) => {
    const townName = clean(r.city || r.district || "", 120);
    if (!townName) return;
    const zoneName = provinceToZone(r.stateProvince) || "";
    const town = townNode(zoneBucket(zoneName), townName);
    town.propertyCount++;
    addCoord(town, r.latitude, r.longitude);
    const suburbName = clean(r.area || "", 120);
    if (suburbName && suburbName.toLowerCase() !== townName.toLowerCase()) {
      const sub = suburbNode(town, suburbName);
      sub.count++;
      addCoord(sub, r.latitude, r.longitude);
    }
  });

  const resortRecord = await resortListStore.get("current", { type: "json" });
  const resortList = (resortRecord && Array.isArray(resortRecord.resorts)) ? resortRecord.resorts : [];
  resortList.forEach((r) => {
    const townName = clean(r.district || "", 120);
    if (!townName) return;
    const zoneName = districtToZone(r.district) || "";
    const town = townNode(zoneBucket(zoneName), townName);
    town.propertyCount++;
    addCoord(town, r.latitude, r.longitude);
  });

  const activities = await loadActivities(activitiesStore);
  activities.filter(Boolean).forEach((r) => {
    const townName = clean(r.area || "", 120);
    if (!townName) return;
    const zoneName = ZONES.includes(r.zone) ? r.zone : (districtToZone(r.area) || "");
    const town = townNode(zoneBucket(zoneName), townName);
    town.activityCount++;
    addCoord(town, r.latitude, r.longitude);
  });

  const result = [];
  zones.forEach((townsMap, zoneName) => {
    const towns = [];
    townsMap.forEach((t) => {
      const suburbs = [];
      t.suburbs.forEach((s) => {
        suburbs.push({
          name: s.name,
          count: s.count,
          latitude: s.coordCount ? s.latSum / s.coordCount : null,
          longitude: s.coordCount ? s.lngSum / s.coordCount : null,
        });
      });
      suburbs.sort((a, b) => a.name.localeCompare(b.name));
      towns.push({
        name: t.name,
        propertyCount: t.propertyCount,
        activityCount: t.activityCount,
        latitude: t.coordCount ? t.latSum / t.coordCount : null,
        longitude: t.coordCount ? t.lngSum / t.coordCount : null,
        suburbs,
      });
    });
    towns.sort((a, b) => a.name.localeCompare(b.name));
    result.push({ zone: zoneName, towns });
  });
  result.sort((a, b) => a.zone.localeCompare(b.zone));
  return result;
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
  const townsStore = getStore({ name: "map-towns", consistency: "strong" });
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

      const activities = (await loadActivities(activitiesStore))
        .filter((r) => r && r.visible !== false)
        .map(toActivityPin);

      // A town allocated to one affiliate (affId set) only appears for that
      // affiliate's own Explore Map / area-hook picker. ?aff=<id> on the
      // request scopes this; omitting it (or the admin's own unfiltered
      // view) returns every visible town, allocated or not. Properties and
      // activities are unaffected — they aren't affiliate-scoped.
      const requestedAff = new URL(request.url).searchParams.get("aff") || "";
      const townMatchesAff = (r) => !r.affId || !requestedAff || r.affId === requestedAff;
      const towns = (await loadTowns(townsStore))
        .filter((r) => r && r.visible !== false)
        // A town qualifies if its own allocation matches (or is
        // shared/unallocated), OR — when it has suburbs — at least one of
        // those suburbs qualifies on its own. This lets one town hold
        // suburbs allocated to different affiliates side by side.
        .filter((r) => {
          const suburbs = Array.isArray(r.suburbs) ? r.suburbs.filter((s) => s && s.visible !== false) : [];
          if (!suburbs.length) return townMatchesAff(r);
          return townMatchesAff(r) || suburbs.some(townMatchesAff);
        })
        .map((r) => {
          const pin = toTownPin(r);
          if (requestedAff) {
            pin.suburbs = pin.suburbs.filter((s) => !s.affId || s.affId === requestedAff);
          }
          return pin;
        });

      return json({ ok: true, properties, activities, towns });
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

      const activities = await loadActivities(activitiesStore);
      const towns = await loadTowns(townsStore);

      return json({ ok: true, properties, activities: activities.filter(Boolean), towns: towns.filter(Boolean), missingCoordinates, resortStats });
    }

    if (action === "discoverLocations") {
      // Read-only by default (body.apply falsy): scans property-listings,
      // the resort-list, and map-activities and returns the full Zone >
      // Town > Suburb tree it finds, flagging which nodes are already Town
      // / Suburb records so the admin UI can show what's new. Pass
      // apply:true to actually create the not-yet-existing towns/suburbs —
      // this only ever ADDS; a town or suburb matched by name (existing
      // ones are never touched) keeps every field an admin already set
      // (affId, description, photos, manual coordinate corrections, etc).
      const tree = await discoverLocationTree({ listingsStore, resortListStore, activitiesStore });
      const existingTowns = await loadTowns(townsStore);
      const existingTownByName = new Map(existingTowns.map((t) => [(t.name || "").toLowerCase(), t]));

      let newTowns = 0, newSuburbs = 0;
      tree.forEach((zoneEntry) => {
        zoneEntry.towns.forEach((t) => {
          const existingTown = existingTownByName.get(t.name.toLowerCase());
          t.existing = !!existingTown;
          if (!existingTown) newTowns++;
          const existingSuburbNames = existingTown && Array.isArray(existingTown.suburbs)
            ? new Set(existingTown.suburbs.map((s) => (s.name || "").toLowerCase()))
            : new Set();
          t.suburbs.forEach((s) => {
            s.existing = existingSuburbNames.has(s.name.toLowerCase());
            if (!s.existing) newSuburbs++;
          });
        });
      });

      if (body.apply) {
        const all = existingTowns.slice();
        const existingIds = new Set(all.map((t) => t.id));
        tree.forEach((zoneEntry) => {
          zoneEntry.towns.forEach((t) => {
            let townRecord = all.find((r) => (r.name || "").toLowerCase() === t.name.toLowerCase());
            if (!townRecord) {
              townRecord = {
                id: genTownUniqueId(existingIds),
                name: t.name,
                area: "",
                zone: ZONES.includes(zoneEntry.zone) ? zoneEntry.zone : "",
                affId: "",
                description: "",
                latitude: t.latitude != null ? String(t.latitude) : "",
                longitude: t.longitude != null ? String(t.longitude) : "",
                visible: true,
                suburbs: [],
                createdAt: new Date().toISOString(),
              };
              townRecord.updatedAt = townRecord.createdAt;
              existingIds.add(townRecord.id);
              all.push(townRecord);
            }
            if (!Array.isArray(townRecord.suburbs)) townRecord.suburbs = [];
            const existingSuburbNames = new Set(townRecord.suburbs.map((s) => (s.name || "").toLowerCase()));
            t.suburbs.forEach((s) => {
              if (existingSuburbNames.has(s.name.toLowerCase())) return;
              const suburbRecord = {
                id: genSuburbUniqueId(allSuburbIds(all)),
                name: s.name,
                affId: "",
                latitude: s.latitude != null ? String(s.latitude) : "",
                longitude: s.longitude != null ? String(s.longitude) : "",
                visible: true,
              };
              townRecord.suburbs.push(suburbRecord);
              existingSuburbNames.add(s.name.toLowerCase());
            });
          });
        });
        await saveTowns(townsStore, all);
        return json({ ok: true, applied: true, createdTowns: newTowns, createdSuburbs: newSuburbs, towns: all });
      }

      return json({ ok: true, applied: false, tree, newTowns, newSuburbs });
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

      // One read, no matter how many activities already exist.
      const existingRecords = await loadActivities(activitiesStore);
      const byId = new Map(existingRecords.map((r) => [r.id, r]));
      const byName = new Map(existingRecords.map((r) => [(r.name || "").toLowerCase(), r]));
      const existingIds = new Set(byId.keys());

      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const matchExisting = (row.id && byId.get(row.id)) || byName.get(row.name.toLowerCase());
        const record = sanitizeActivity(row, matchExisting || {});
        if (matchExisting) {
          record.id = matchExisting.id;
          record.updatedAt = new Date().toISOString();
          updated++;
        } else {
          record.id = genUniqueActivityId(existingIds);
          existingIds.add(record.id);
          record.createdAt = new Date().toISOString();
          record.updatedAt = record.createdAt;
          created++;
        }
        byId.set(record.id, record);
        byName.set((record.name || "").toLowerCase(), record);
      }

      // One write, whatever the batch size — byId still holds every
      // untouched existing record too, since nothing is ever deleted from it.
      await saveActivities(activitiesStore, Array.from(byId.values()));

      return json({ ok: true, created: created, updated: updated });
    }

    if (action === "importTownsCsv") {
      const csvText = typeof body.csv === "string" ? body.csv : "";
      if (!csvText.trim()) return json({ error: "Uploaded file was empty." }, 400);
      const rows = parseTownsCsv(csvText);
      if (!rows.length) return json({ error: "Could not find any town rows (need at least a 'name' column)." }, 400);

      const existingRecords = await loadTowns(townsStore);
      const byId = new Map(existingRecords.map((r) => [r.id, r]));
      const byName = new Map(existingRecords.map((r) => [(r.name || "").toLowerCase(), r]));
      const existingIds = new Set(byId.keys());

      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const matchExisting = (row.id && byId.get(row.id)) || byName.get(row.name.toLowerCase());
        const record = sanitizeTown(row, matchExisting || {});
        if (matchExisting) {
          record.id = matchExisting.id;
          record.updatedAt = new Date().toISOString();
          updated++;
        } else {
          record.id = genTownUniqueId(existingIds);
          existingIds.add(record.id);
          record.createdAt = new Date().toISOString();
          record.updatedAt = record.createdAt;
          created++;
        }
        byId.set(record.id, record);
        byName.set((record.name || "").toLowerCase(), record);
      }

      await saveTowns(townsStore, Array.from(byId.values()));

      return json({ ok: true, created: created, updated: updated });
    }

    if (action === "addTown") {
      const all = await loadTowns(townsStore);
      const id = genTownUniqueId(new Set(all.map((r) => r.id)));
      const record = sanitizeTown(body, {});
      record.id = id;
      record.createdAt = new Date().toISOString();
      record.updatedAt = record.createdAt;
      if (!record.name) return json({ error: "Town name is required." }, 400);
      all.push(record);
      await saveTowns(townsStore, all);
      return json({ ok: true, town: record });
    }

    if (action === "updateTown") {
      const id = clean(body.id, 20);
      if (!id) return json({ error: "missing id" }, 400);
      const all = await loadTowns(townsStore);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return json({ error: "not found" }, 404);
      const record = sanitizeTown(body, all[idx]);
      record.updatedAt = new Date().toISOString();
      all[idx] = record;
      await saveTowns(townsStore, all);
      return json({ ok: true, town: record });
    }

    if (action === "deleteTown") {
      const id = clean(body.id, 20);
      if (!id) return json({ error: "missing id" }, 400);
      const all = await loadTowns(townsStore);
      await saveTowns(townsStore, all.filter((r) => r.id !== id));
      return json({ ok: true });
    }

    if (action === "addTownPhoto") {
      const id = clean(body.id, 20);
      const photoKey = clean(body.photoKey, 300);
      if (!id || !photoKey) return json({ error: "missing id or photoKey" }, 400);
      const all = await loadTowns(townsStore);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return json({ error: "not found" }, 404);
      const existing = all[idx];
      const keys = Array.isArray(existing.photoKeys) ? existing.photoKeys.slice() : existing.photoKey ? [existing.photoKey] : [];
      if (keys.length >= 12) return json({ error: "Maximum 12 photos per town." }, 400);
      keys.push(photoKey);
      existing.photoKeys = keys;
      delete existing.photoKey;
      existing.updatedAt = new Date().toISOString();
      all[idx] = existing;
      await saveTowns(townsStore, all);
      return json({ ok: true, town: existing });
    }

    if (action === "removeTownPhoto") {
      const id = clean(body.id, 20);
      const photoKey = clean(body.photoKey, 300);
      if (!id || !photoKey) return json({ error: "missing id or photoKey" }, 400);
      const all = await loadTowns(townsStore);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return json({ error: "not found" }, 404);
      const existing = all[idx];
      const keys = Array.isArray(existing.photoKeys) ? existing.photoKeys.slice() : existing.photoKey ? [existing.photoKey] : [];
      existing.photoKeys = keys.filter((k) => k !== photoKey);
      delete existing.photoKey;
      existing.updatedAt = new Date().toISOString();
      all[idx] = existing;
      await saveTowns(townsStore, all);
      return json({ ok: true, town: existing });
    }

    if (action === "addSuburb") {
      const townId = clean(body.townId, 20);
      if (!townId) return json({ error: "missing townId" }, 400);
      const all = await loadTowns(townsStore);
      const idx = all.findIndex((r) => r.id === townId);
      if (idx === -1) return json({ error: "town not found" }, 404);
      const town = all[idx];
      if (!Array.isArray(town.suburbs)) town.suburbs = [];
      const record = sanitizeSuburb(body, {});
      if (!record.name) return json({ error: "Suburb name is required." }, 400);
      record.id = genSuburbUniqueId(allSuburbIds(all));
      town.suburbs.push(record);
      town.updatedAt = new Date().toISOString();
      all[idx] = town;
      await saveTowns(townsStore, all);
      return json({ ok: true, town });
    }

    if (action === "updateSuburb") {
      const townId = clean(body.townId, 20);
      const suburbId = clean(body.suburbId, 20);
      if (!townId || !suburbId) return json({ error: "missing townId or suburbId" }, 400);
      const all = await loadTowns(townsStore);
      const idx = all.findIndex((r) => r.id === townId);
      if (idx === -1) return json({ error: "town not found" }, 404);
      const town = all[idx];
      const suburbs = Array.isArray(town.suburbs) ? town.suburbs : [];
      const sIdx = suburbs.findIndex((s) => s.id === suburbId);
      if (sIdx === -1) return json({ error: "suburb not found" }, 404);
      suburbs[sIdx] = sanitizeSuburb(body, suburbs[sIdx]);
      town.suburbs = suburbs;
      town.updatedAt = new Date().toISOString();
      all[idx] = town;
      await saveTowns(townsStore, all);
      return json({ ok: true, town });
    }

    if (action === "deleteSuburb") {
      const townId = clean(body.townId, 20);
      const suburbId = clean(body.suburbId, 20);
      if (!townId || !suburbId) return json({ error: "missing townId or suburbId" }, 400);
      const all = await loadTowns(townsStore);
      const idx = all.findIndex((r) => r.id === townId);
      if (idx === -1) return json({ error: "town not found" }, 404);
      const town = all[idx];
      town.suburbs = (Array.isArray(town.suburbs) ? town.suburbs : []).filter((s) => s.id !== suburbId);
      town.updatedAt = new Date().toISOString();
      all[idx] = town;
      await saveTowns(townsStore, all);
      return json({ ok: true, town });
    }

    if (action === "addActivity") {
      const all = await loadActivities(activitiesStore);
      const id = genUniqueActivityId(new Set(all.map((r) => r.id)));
      const record = sanitizeActivity(body, {});
      record.id = id;
      record.createdAt = new Date().toISOString();
      record.updatedAt = record.createdAt;
      if (!record.name) return json({ error: "Activity name is required." }, 400);
      all.push(record);
      await saveActivities(activitiesStore, all);
      return json({ ok: true, activity: record });
    }

    if (action === "updateActivity") {
      const id = clean(body.id, 20);
      if (!id) return json({ error: "missing id" }, 400);
      const all = await loadActivities(activitiesStore);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return json({ error: "not found" }, 404);
      const record = sanitizeActivity(body, all[idx]);
      record.updatedAt = new Date().toISOString();
      all[idx] = record;
      await saveActivities(activitiesStore, all);
      return json({ ok: true, activity: record });
    }

    if (action === "deleteActivity") {
      const id = clean(body.id, 20);
      if (!id) return json({ error: "missing id" }, 400);
      const all = await loadActivities(activitiesStore);
      await saveActivities(activitiesStore, all.filter((r) => r.id !== id));
      return json({ ok: true });
    }

    if (action === "addActivityPhoto") {
      const id = clean(body.id, 20);
      const photoKey = clean(body.photoKey, 300);
      if (!id || !photoKey) return json({ error: "missing id or photoKey" }, 400);
      const all = await loadActivities(activitiesStore);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return json({ error: "not found" }, 404);
      const existing = all[idx];
      const keys = Array.isArray(existing.photoKeys) ? existing.photoKeys.slice() : existing.photoKey ? [existing.photoKey] : [];
      if (keys.length >= 12) return json({ error: "Maximum 12 photos per activity." }, 400);
      keys.push(photoKey);
      existing.photoKeys = keys;
      delete existing.photoKey;
      existing.updatedAt = new Date().toISOString();
      all[idx] = existing;
      await saveActivities(activitiesStore, all);
      return json({ ok: true, activity: existing });
    }

    if (action === "removeActivityPhoto") {
      const id = clean(body.id, 20);
      const photoKey = clean(body.photoKey, 300);
      if (!id || !photoKey) return json({ error: "missing id or photoKey" }, 400);
      const all = await loadActivities(activitiesStore);
      const idx = all.findIndex((r) => r.id === id);
      if (idx === -1) return json({ error: "not found" }, 404);
      const existing = all[idx];
      const keys = Array.isArray(existing.photoKeys) ? existing.photoKeys.slice() : existing.photoKey ? [existing.photoKey] : [];
      existing.photoKeys = keys.filter((k) => k !== photoKey);
      delete existing.photoKey;
      existing.updatedAt = new Date().toISOString();
      all[idx] = existing;
      await saveActivities(activitiesStore, all);
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
