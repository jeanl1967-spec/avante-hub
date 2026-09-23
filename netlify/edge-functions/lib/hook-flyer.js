// Resolves one hook's real, already-saved data onto a flyer template's
// field keys (see lib/hook-templates.js for what each key means and where
// it's positioned). This is the "never invent flyer content" boundary for
// the whole flyer feature: every value returned here traces to one of
// three places —
//   1. Auto-build's scraped StockNetwork data, saved onto the hook record's
//      `source` field by lib/hook-photos.js's saveHookPhotoUrls (name,
//      description, attractions, roomType);
//   2. Jean's (or the affiliate's) own typed input — the hook's saved
//      flyerPromoTag/flyerPrice/flyerDates/locationLabel fields, or the
//      shared "Flyer contact info" admin setting;
//   3. Fixed brand copy ("Contact us") that's the same on every flyer.
// A field with nothing real to draw from comes back as "" (blank) — never
// a guess — and is also listed in `missing`, so the generation UI can show
// it as an empty box a human still needs to fill in before the flyer is
// finished, exactly like every other optional field in this app.
//
// resolveFlyerFields(template, hookRecord, contactSettings, overrides?)
// hookRecord: the raw stored promo-hooks record for this hook (whichever
//   one actually carries the content — the admin's own record for an
//   admin-managed hook, this affiliate's own record for self-managed).
// contactSettings: { contactPhone, contactEmail } from the shared
//   "flyer-settings" store (see admin-api.js's getFlyerSettings/
//   setFlyerSettings actions) — same contact details on every flyer.
// overrides: optional { [fieldKey]: string } — a human's own edits from the
//   generation preview screen, applied last so anything typed there always
//   wins over the auto-resolved default.
// Returns { values: { [fieldKey]: string }, missing: string[] }.
//
// Dispatches by template.category: property-flyer-v1 (StockNetwork-backed,
// the original behavior) vs event-flyer-v1 (every field typed in directly
// — see resolveEventFlyerFields below). Any future category with nothing
// implemented here yet just falls back to leaving every field blank rather
// than throwing, so a generation attempt reports "everything's missing"
// instead of crashing.
export function resolveFlyerFields(template, hookRecord, contactSettings, overrides) {
  if (template && template.category === "event") {
    return resolveEventFlyerFields(template, hookRecord, overrides);
  }
  return resolvePropertyFlyerFields(template, hookRecord, contactSettings, overrides);
}

function resolvePropertyFlyerFields(template, hookRecord, contactSettings, overrides) {
  const record = hookRecord && typeof hookRecord === "object" ? hookRecord : {};
  const src = record.source && typeof record.source === "object" ? record.source : {};
  const settings = contactSettings && typeof contactSettings === "object" ? contactSettings : {};

  const name = typeof src.label === "string" ? src.label.trim() : "";
  const rawArea = typeof record.locationLabel === "string" ? record.locationLabel.trim() : "";
  // locationLabel is meant to name the AREA a property is in (a town or
  // suburb, e.g. "Hermanus") — but when a hook was auto-built from a
  // single, individually-picked property (rather than a whole ticked
  // suburb/town), there's no separate area name to fall back on, so
  // buildHookDraft (lib/hook-draft.js) and the tree's own selection-label
  // computation (admin.html/hub.html's computeSelectionLabel) both end up
  // reusing the property's own name as its "location" too. Left as-is that
  // produces "Lions Rock Rapids Camp • Lions Rock Rapids Camp" and "In
  // Lions Rock Rapids Camp!" on the flyer — a visibly broken duplicate
  // Jean flagged directly (screenshot, 2026-09-23). Guarding against it
  // here, at the one place every hook's flyer fields are resolved, fixes
  // every hook built this way (already-saved ones included) without
  // needing to touch how locationLabel gets set upstream.
  const area = rawArea && rawArea.toLowerCase() !== name.toLowerCase() ? rawArea : "";
  const description = typeof src.description === "string" ? src.description.trim() : "";
  const attractions = typeof src.attractions === "string" ? src.attractions.trim() : "";
  const roomType = typeof src.roomType === "string" ? src.roomType.trim() : "";

  const amenities = splitIntoBullets(attractions, 3);

  const values = {
    promoTag: (record.flyerPromoTag || "").trim(),
    // No reliable "property type" field comes out of StockNetwork's scrape
    // (roomType is closer to "6 Sleeper" than "Holiday House") — left blank
    // for a human to type, same treatment as price/dates/promo.
    headlineLine1: "",
    headlineLine2: area ? "In " + area + "!" : "",
    priceBadge: (record.flyerPrice || "").trim(),
    keyStat: roomType,
    propertyNameArea: [name, area].filter(Boolean).join(" • "),
    dateRange: (record.flyerDates || "").trim(),
    description: description,
    sectionHeading: name ? name + " Perks Included" : "",
    amenity1: amenities[0] || "",
    amenity2: amenities[1] || "",
    amenity3: amenities[2] || "",
    contactLabel: "Contact us",
    // This hook's own contact override wins if it's set anything (saved via
    // the saveFlyerContact action — see admin-api.js/hook-api.js), else
    // fall back to the shared account-wide default. Lets different hooks,
    // serviced by different people, show different contact details.
    contactPhone: (record.flyerContactPhone || settings.contactPhone || "").trim(),
    contactEmail: (record.flyerContactEmail || settings.contactEmail || "").trim(),
  };

  if (overrides && typeof overrides === "object") {
    for (const field of template.fields) {
      const key = field.key;
      if (typeof overrides[key] === "string") values[key] = overrides[key].trim().slice(0, 2000);
    }
  }

  const missing = template.fields.filter((f) => !values[f.key]).map((f) => f.key);
  return { values: values, missing: missing };
}

// Turns a prose "attractions" blob (real scraped text — comma/period/pipe
// separated, however StockNetwork happened to punctuate it) into up to
// `max` short bullet-sized chunks. This only re-chunks real text into the
// template's bullet slots — it never invents an amenity that wasn't in the
// source text.
function splitIntoBullets(text, max) {
  if (!text) return [];
  // StockNetwork's scraped "attractions" text is often a single run-on
  // sentence that OPENS with a generic throat-clearing clause — "Nearby
  // attractions / activities can include day trips into the Cederberg,
  // whale watching, ..." — before it ever gets to a real, nameable
  // amenity. Splitting on punctuation alone (below) made that whole
  // intro the first "bullet", which is long, isn't really an amenity,
  // and got hard-truncated mid-word with an ellipsis — exactly the
  // garbled "Nearby attractions / activities can include day trips
  // int…" bullet Jean flagged (screenshot, 2026-09-23). Stripping a
  // single leading "...can include/includes/included:" clause (bounded
  // to 100 chars so it can never eat a real, longer sentence) before
  // splitting means the first bullet starts at the first real list item
  // ("day trips into the Cederberg") instead of the throat-clearing
  // intro. Only the first such clause is stripped — real content later
  // in the text that happens to contain "include" is left untouched.
  const withoutIntro = text.replace(/^.{0,100}?\binclude[sd]?\b:?\s*/i, "");
  // Was: only split on a comma when it's directly followed by a capital
  // letter, to avoid chopping up a genuine sentence. But a comma-separated
  // *list* of attractions ("day trips into the Cederberg, whale watching
  // in season, and local wine tasting") is normal, lowercase, StockNetwork
  // text — under the old rule that whole list stayed as one bullet and
  // still got hard-truncated with an ellipsis, just starting one clause
  // later than before. Splitting on every comma (optionally followed by a
  // connecting "and"/"or", which is stripped so the bullet doesn't start
  // with it) turns that into three real, short bullets instead of one
  // long truncated one — matching what Jean's screenshot showed was
  // needed. This function is only ever fed the `attractions` field (a
  // list of real scraped items), never free-form prose, so splitting on
  // every comma is safe here.
  const parts = withoutIntro
    .split(/[.;|•\n]+|,\s*(?:and\s+|or\s+)?/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(0, max).map((s) => (s.length > 60 ? s.slice(0, 57).trim() + "…" : s));
}

// event-flyer-v1's resolver — much simpler than the property one above
// since there's no StockNetwork scrape to pull from: an event isn't a
// listed property, so every field here is Jean's (or an affiliate's) own
// typed input, saved directly onto the hook record under the matching
// eventXxx key (see admin-api.js's setDefaultHook / hook-api.js's plain
// save path). A field left blank on the form comes back blank here too —
// never invented — same "missing" reporting the property resolver uses.
function resolveEventFlyerFields(template, hookRecord, overrides) {
  const record = hookRecord && typeof hookRecord === "object" ? hookRecord : {};
  const values = {};
  for (const field of template.fields) {
    const raw = record[field.key];
    values[field.key] = typeof raw === "string" ? raw.trim() : "";
  }
  if (overrides && typeof overrides === "object") {
    for (const field of template.fields) {
      const key = field.key;
      if (typeof overrides[key] === "string") values[key] = overrides[key].trim().slice(0, 2000);
    }
  }
  const missing = template.fields.filter((f) => !values[f.key]).map((f) => f.key);
  return { values: values, missing: missing };
}

// Which of a hook's saved photos (in save order: cover first, then
// gallery 1, 2, ...) fills which image slot on the template. Fixed by
// position for now — StockNetwork's own gallery order (cover photo first)
// is real, meaningful ordering, not a random pick, but this doesn't try to
// tell a beach shot from a kitchen shot on its own. A human can still swap
// which photo goes where from the generation preview.
export function defaultPhotoSlotOrder(template) {
  return template.images.map((img) => img.key);
}
