import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

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

function parseResortNamesFromCsv(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]);
  let nameColIdx = header.findIndex((h) => h.trim().toLowerCase() === "resort");
  if (nameColIdx === -1) nameColIdx = 0;

  const seen = new Set();
  const names = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const name = (fields[nameColIdx] || "").trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  names.sort((a, b) => a.localeCompare(b));
  return names;
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

      const resorts = parseResortNamesFromCsv(text);
      if (!resorts.length) {
        return new Response(JSON.stringify({ ok: false, error: "Could not find any resort names in that file." }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

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
