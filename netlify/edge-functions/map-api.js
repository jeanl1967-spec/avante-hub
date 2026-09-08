import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";
import { ZONES, provinceToZone } from "./lib/zones.js";

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

function genActivityId() {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return "A-" + n;
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

  try {
    if (request.method === "GET") {
      const { blobs } = await listingsStore.list();
      const listings = await Promise.all(blobs.map((b) => listingsStore.get(b.key, { type: "json" })));
      const { blobs: visBlobs } = await visibilityStore.list();
      const visFlags = await Promise.all(visBlobs.map((b) => visibilityStore.get(b.key, { type: "json" })));
      const hiddenIds = new Set(
        visBlobs.filter((b, i) => visFlags[i] && visFlags[i].hidden).map((b) => b.key)
      );

      const properties = listings
        .filter((r) => r && r.status === "Listed")
        .filter((r) => !hiddenIds.has(r.listingId))
        .map((r) => toPropertyPin(r, false))
        .filter(Boolean);

      const { blobs: actBlobs } = await activitiesStore.list();
      const activities = (await Promise.all(actBlobs.map((b) => activitiesStore.get(b.key, { type: "json" }))))
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
      const listings = await Promise.all(blobs.map((b) => listingsStore.get(b.key, { type: "json" })));
      const { blobs: visBlobs } = await visibilityStore.list();
      const visRecords = await Promise.all(visBlobs.map((b) => visibilityStore.get(b.key, { type: "json" })));
      const hiddenIds = new Set(visBlobs.filter((b, i) => visRecords[i] && visRecords[i].hidden).map((b) => b.key));

      const properties = listings
        .filter((r) => r && r.status === "Listed")
        .map((r) => toPropertyPin(r, hiddenIds.has(r.listingId)))
        .filter(Boolean);

      const { blobs: actBlobs } = await activitiesStore.list();
      const activities = await Promise.all(actBlobs.map((b) => activitiesStore.get(b.key, { type: "json" })));

      return json({ ok: true, properties, activities: activities.filter(Boolean) });
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
