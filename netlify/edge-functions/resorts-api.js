import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";
import { mergeResorts } from "./lib/resort-key.js";

// Minimal CSV field-splitter (handles quoted fields, embedded commas, and
// "" escaped quotes) — we only need the first column (the resort name), but
// we parse the whole line properly so a quoted name containing a comma still
// works correctly.
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

// Parses the resort master CSV into { name, district, suburb, zoneHint,
// siteId, resortId, latitude, longitude } per row. Every field is looked up
// by header name so the parser doesn't break if StockNetwork reorders
// columns; siteId/resortId fall back to the last two columns (their known
// position) if the headers aren't found by name. The "town" field accepts
// a few different header spellings, since different StockNetwork exports
// have called this column District, Town, or City — first one found wins.
// suburb/area and zone/province are all optional finer-grained columns:
// present on some exports, absent on others, and only used (by
// map-api.js's location-discovery feature) when they're there — a row
// missing any of them just gets "" for that field and every existing
// caller of this file keeps working exactly as before. Latitude/Longitude
// are likewise optional. Rows are kept even if they share a name with
// another row — different physical properties can share a name, and each
// needs its own SiteID/ResortID for the Resort Info Link to work. Only
// exact duplicate rows (same name + siteId + resortId) are collapsed.
function parseResortsFromCsv(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const findCol = (names) => {
    for (const name of names) {
      const idx = header.findIndex((h) => h === name);
      if (idx > -1) return idx;
    }
    return -1;
  };

  let nameIdx = findCol(["resort"]);
  const districtIdx = findCol(["district", "town", "town/city", "city"]);
  const suburbIdx = findCol(["suburb", "area"]);
  const zoneHintIdx = findCol(["zone", "province", "state", "stateprovince", "state/province"]);
  let siteIdIdx = findCol(["siteid"]);
  let resortIdIdx = findCol(["resortid"]);
  const latIdx = findCol(["latitude"]);
  const lngIdx = findCol(["longitude"]);
  if (nameIdx === -1) nameIdx = 0;
  if (resortIdIdx === -1) resortIdIdx = header.length - 1;
  if (siteIdIdx === -1) siteIdIdx = header.length - 2;

  const seen = new Set();
  const resorts = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const name = (fields[nameIdx] || "").trim();
    if (!name) continue;

    const district = districtIdx > -1 ? (fields[districtIdx] || "").trim() : "";
    const suburb = suburbIdx > -1 ? (fields[suburbIdx] || "").trim() : "";
    const zoneHint = zoneHintIdx > -1 ? (fields[zoneHintIdx] || "").trim() : "";
    const siteId = siteIdIdx > -1 ? (fields[siteIdIdx] || "").trim() : "";
    const resortId = resortIdIdx > -1 ? (fields[resortIdIdx] || "").trim() : "";
    const latitude = latIdx > -1 ? (fields[latIdx] || "").trim() : "";
    const longitude = lngIdx > -1 ? (fields[lngIdx] || "").trim() : "";

    const key = name.toLowerCase() + "|" + siteId + "|" + resortId;
    if (seen.has(key)) continue;
    seen.add(key);
    resorts.push({ name, district, suburb, zoneHint, siteId, resortId, latitude, longitude });
  }

  resorts.sort((a, b) => a.name.localeCompare(b.name) || a.district.localeCompare(b.district));
  return resorts;
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

  const store = getStore({ name: "resort-list", consistency: "strong" });

  try {
    if (request.method === "GET") {
      const record = await store.get("current", { type: "json" });
      const resorts = record && Array.isArray(record.resorts) ? record.resorts : [];
      const updatedAt = (record && record.updatedAt) || null;
      return new Response(JSON.stringify({ resorts, updatedAt, count: resorts.length }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (request.method === "POST") {
      const text = await request.text();
      if (!text || !text.trim()) {
        return new Response(JSON.stringify({ ok: false, error: "Uploaded file was empty." }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      const freshResorts = parseResortsFromCsv(text);
      if (!freshResorts.length) {
        return new Response(JSON.stringify({ ok: false, error: "Could not find any resort names in that file." }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      // Merge onto the previous list rather than replacing it outright, so
      // any property an admin assigned to an affiliate (see admin-api.js's
      // setResortAffId) keeps that assignment across this re-import — every
      // other field (name/district/suburb/zoneHint/lat/lng) still comes
      // fresh from this file, only affId carries forward. See
      // lib/resort-key.js for the matching rules.
      const previousRecord = await store.get("current", { type: "json" });
      const previousResorts = previousRecord && Array.isArray(previousRecord.resorts) ? previousRecord.resorts : [];
      const resorts = mergeResorts(previousResorts, freshResorts);

      const updatedAt = new Date().toISOString();
      await store.setJSON("current", { resorts, updatedAt });

      return new Response(JSON.stringify({ ok: true, count: resorts.length, updatedAt, resorts }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
};

export const config = { path: "/api/resorts" };
