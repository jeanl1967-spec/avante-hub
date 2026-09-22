// Shared "themes ever typed" list for Event hooks (see hook-templates.js's
// event-flyer-v1 and admin-api.js's Event fields). Grows automatically:
// every distinct theme a human types into an Event hook's Theme field
// (whale watching, cycling, music, ...) is remembered here once, so it
// shows up as a pick in every future Event hook's Theme dropdown too —
// nothing pre-seeded, nothing invented, just what's actually been typed
// before. Stored as a single JSON array under one fixed key ("list") in
// the "event-themes" Blobs store — small, low-churn data, no need to key
// per-item the way per-hook stores do.

// Returns the current list, alphabetically sorted. Empty array if nothing's
// been typed yet.
export async function listThemes(store) {
  const list = await store.get("list", { type: "json" });
  return Array.isArray(list) ? list : [];
}

// Adds `theme` to the saved list if it's new (case-insensitive dedupe —
// "Whale Watching" and "whale watching" are the same theme — keeps
// whichever casing was typed first). No-ops on a blank value or one
// that's already saved; returns the resulting list either way, so a
// caller can always trust the return value reflects what's now stored.
export async function rememberTheme(store, theme) {
  const name = typeof theme === "string" ? theme.trim().slice(0, 80) : "";
  const list = await listThemes(store);
  if (!name) return list;
  const exists = list.some((t) => String(t).toLowerCase() === name.toLowerCase());
  if (exists) return list;
  const next = [...list, name].sort((a, b) => a.localeCompare(b));
  await store.setJSON("list", next);
  return next;
}
