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
export function resolveFlyerFields(template, hookRecord, contactSettings, overrides) {
  const record = hookRecord && typeof hookRecord === "object" ? hookRecord : {};
  const src = record.source && typeof record.source === "object" ? record.source : {};
  const settings = contactSettings && typeof contactSettings === "object" ? contactSettings : {};

  const name = typeof src.label === "string" ? src.label.trim() : "";
  const area = typeof record.locationLabel === "string" ? record.locationLabel.trim() : "";
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
    contactPhone: (settings.contactPhone || "").trim(),
    contactEmail: (settings.contactEmail || "").trim(),
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
  const parts = text
    .split(/[.;|•\n]+|,\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(0, max).map((s) => (s.length > 60 ? s.slice(0, 57).trim() + "…" : s));
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
