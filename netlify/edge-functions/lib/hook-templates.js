// Registry of hook flyer templates — Canva designs that a Default Hook or a
// self-managed affiliate hook can be turned into a finished, branded flyer
// image from. This file only *registers* what each template's placeholders
// are and where each one's real-world content has to come from; it does not
// itself generate a flyer. That generation pipeline (copy the master design
// in Canva, fill in each placeholder from real data, export an image, and
// the matching landing-page template) is a separate, later piece of work —
// this registry is what that pipeline will be built against.
//
// Per Jean's standing rule (see flyer-template-system.md): nothing on a
// flyer may ever be invented by Claude. Every field below must be filled
// from one of three sources only — StockNetwork property data (via
// buildHookDraft / hook-source.js), Jean's own direct input, or plain web
// research she's asked for. A field with no real value for a given
// property must be left blank/omitted, never guessed.
//
// -----------------------------------------------------------------------
// Template: property-flyer-v1
// -----------------------------------------------------------------------
// Source design: Jean's "AVANTE MASTER FLYER TEMPLATE — copy only, never
// edit directly" (Canva design id below). Category: a single property /
// resort stay promo — the first hook template, matching the resort
// category of Default Hooks and self-managed property hooks. The paired
// landing-page template for this hook is intentionally not built yet.
//
// masterDesignId is the one to `copy-design` from every time a flyer is
// generated — never edit it directly (Jean's own instruction, baked into
// the design's title in Canva). Each generation run gets its own copy with
// its own fresh locator_ids, so this registry deliberately does NOT store
// locator_ids (they don't survive a copy). Instead each field's `matchText`
// (for text) or `matchAltText` (for images) is what the generation code
// should use to find the right element on that fresh copy — search
// design_content for the element whose current text/alt-text equals the
// placeholder value captured here, then edit that element's own
// locator_id. Falling back to `geometry` (approximate top/left/width/height
// in the template's 1080x1350 canvas) is the tie-breaker if a placeholder's
// text has visibly already been changed by hand in Canva before a copy.
export const HOOK_TEMPLATES = {
  "property-flyer-v1": {
    category: "property",
    label: "Property / resort stay flyer",
    masterDesignId: "DAHV0C5HhVM",
    canvasSize: { width: 1080, height: 1350 },
    // Content fields, in the order they read on the flyer.
    fields: [
      {
        key: "promoTag",
        type: "text",
        role: "Small banner strip across the top — a short promo/offer tag, e.g. a release window or sale name.",
        matchText: "December Late Release in Keurbooms",
        source: "jean", // Jean names the promo/offer; not something StockNetwork provides.
      },
      {
        key: "headlineLine1",
        type: "text",
        role: "Headline, line 1 — short punchy lead-in (e.g. property type).",
        matchText: "Holiday House",
        source: "stocknetwork+jean",
      },
      {
        key: "headlineLine2",
        type: "text",
        role: "Headline, line 2 — usually the destination/area, e.g. \"In <Town>!\"",
        matchText: "In Plett!",
        source: "stocknetwork+jean",
      },
      {
        key: "priceBadge",
        type: "text",
        role: "Price badge — two lines: the headline rate, then a per-person/qualifier line.",
        matchText: "R3500 PER DAY\nUnder R600 p/p",
        source: "stocknetwork", // real nightly/daily rate + occupancy math only, never invented.
      },
      {
        key: "keyStat",
        type: "text",
        role: "Big single stat under the headline — usually sleeps/occupancy count.",
        matchText: "6 Sleeper",
        source: "stocknetwork",
      },
      {
        key: "propertyNameArea",
        type: "text",
        role: "Property name and area, e.g. \"<Resort Name> • <Suburb/Town>\".",
        matchText: "The Dunes Resort & Hotel • Keurboomstrand",
        source: "stocknetwork",
      },
      {
        key: "dateRange",
        type: "text",
        role: "Availability/stay window for the promo, e.g. peak-season dates and length of stay.",
        matchText: "18 December to 1 January – Peak Season Stay (14 Days)",
        source: "jean",
      },
      {
        key: "description",
        type: "text",
        role: "Main body paragraph — room configuration, key amenities, walking distance to notable features.",
        matchText:
          "2 Spacious Bedrooms | 2 Modern Bathrooms. Fully Equipped Self-Catering Kitchen & Open-Plan Living (4 adults 2 kids under 12). Enclosed Private Garden & Shaded Patio with Built-In Braai. 3-min Walk to Private Beach, Wooden Decks & Ocean-side Picnic Spots.",
        source: "stocknetwork", // drafted the same way draftHookCaption already works from scraped resort info.
      },
      {
        key: "sectionHeading",
        type: "text",
        role: "Heading over the amenities list, e.g. \"<Resort> Perks Included\".",
        matchText: "Resort Perks Included",
        source: "stocknetwork+jean",
      },
      {
        key: "amenity1",
        type: "text",
        role: "Amenity bullet 1.",
        matchText: "2 Sparkling Pools and Beach Access ",
        source: "stocknetwork",
      },
      {
        key: "amenity2",
        type: "text",
        role: "Amenity bullet 2.",
        matchText: "24/7 Gated Security, Private Parking",
        source: "stocknetwork",
      },
      {
        key: "amenity3",
        type: "text",
        role: "Amenity bullet 3.",
        matchText: "High-Speed Wi-Fi, Cafe & Laundromat",
        source: "stocknetwork",
      },
      {
        key: "contactLabel",
        type: "text",
        role: "Small label above the contact phone number, e.g. \"Contact us\".",
        matchText: "Contact us",
        source: "fixed", // brand copy, same on every flyer — not per-property.
      },
      {
        key: "contactPhone",
        type: "text",
        role: "Contact phone number.",
        matchText: "071 605 0055",
        source: "jean",
      },
      {
        key: "contactEmail",
        type: "text",
        role: "Contact email address.",
        matchText: "marketing@avantehospitality.co.za",
        source: "jean",
      },
    ],
    // Image fields. altText survives on the master design (Canva keeps it on
    // the element, not tied to the specific media file), so it's the
    // primary match key; geometry is the fallback if altText was cleared.
    images: [
      {
        key: "heroImage",
        role: "Large hero photo filling the right-hand panel of the flyer.",
        matchAltText: null, // no alt text set on the master's hero element — match by geometry.
        geometry: { top: 476.61, left: 623.92, width: 456.08, height: 869.39 },
        source: "stocknetwork", // pulled from the property's photo gallery, same pool buildHookDraft already builds.
      },
      {
        key: "featureImage",
        role: "Upper circular inset photo — a wide/establishing shot (e.g. beach, coastline, grounds).",
        matchAltText: "Aerial view of Keurboomstrand beach and coastline",
        geometry: { top: -80.98, left: 574.46, width: 678.27, height: 678.27 },
        source: "stocknetwork",
      },
      {
        key: "lifestyleImage",
        role: "Lower circular inset photo — an interior/amenity close-up (e.g. kitchen, living area).",
        matchAltText: "Open-plan kitchen and living area",
        geometry: { top: 450.42, left: 633.32, width: 397.86, height: 397.86 },
        source: "stocknetwork",
      },
    ],
    // Elements on the master that are brand chrome, not per-flyer content —
    // the generation pipeline must leave these untouched:
    //  - the Avante Travel logo (top-left)
    //  - the three amenity check-mark icons and the phone icon
    //  - all decorative background shapes (circles, banner pills)
    notEditable: ["brand logo", "amenity check icons", "phone icon", "decorative shapes"],
  },
};

// Look up a template by id. Returns undefined if unknown.
export function getHookTemplate(templateId) {
  return HOOK_TEMPLATES[templateId];
}

// The template a given hook category should use by default. Only one
// category exists so far (property/resort flyers); this indirection just
// keeps room for the landing-page template and other hook categories that
// are still to come, without another lookup table needing to change shape.
export function defaultTemplateForCategory(category) {
  if (category === "property" || category === "resort") return HOOK_TEMPLATES["property-flyer-v1"];
  return undefined;
}
