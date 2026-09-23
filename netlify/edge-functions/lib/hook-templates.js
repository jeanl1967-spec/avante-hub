// Registry of hook flyer templates — Canva designs that a Default Hook or a
// self-managed affiliate hook can be turned into a finished, branded flyer
// image from, WITHOUT calling Canva at all when a flyer is actually
// generated. Every field below (text position, size, color, font weight,
// and — for the three photos — exact crop box) was captured once, directly
// from Jean's real master design in Canva (see masterDesignId), by reading
// its full structured page content. That's a one-time capture, done here in
// this registry; lib/hook-flyer-svg.js then draws a fresh flyer from these
// exact numbers plus a hook's real data — no live Canva call, no Canva API
// credential needed, at generation time.
//
// Per Jean's standing rule (see flyer-template-system.md): nothing on a
// flyer may ever be invented by Claude. Every field below must be filled
// from one of three sources only — StockNetwork property data (via
// buildHookDraft / hook-source.js, saved onto the hook record's `source` by
// saveHookPhotoUrls), Jean's own direct input (the flyerPromoTag/flyerPrice/
// flyerDates fields, or the shared contact-info settings), or plain web
// research she's asked for. lib/hook-flyer.js (the field resolver) leaves a
// field blank rather than guessing when a hook has nothing real to fill it
// with — the generation UI shows that as an empty box for a human to fill
// in, never a placeholder value standing in for real content.
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
// masterDesignId is kept here purely as a record of where this layout came
// from — it is NOT read from again at generation time. canvasSize is the
// exact page size (px) every geometry number below is relative to;
// hook-flyer-svg.js draws its SVG viewBox at this same size so nothing
// needs rescaling.
//
// Each text field's `geometry` (top/left/width/height, in canvasSize px)
// and `style` (fontSize/fontWeight/color/textAlign/decoration, plus which
// of the two brand fonts already loaded in admin.html/hub.html —
// Montserrat or Noto Sans — it uses) are the exact values captured from the
// master design's own text elements. `font: "heading"` = Montserrat (the
// bold display font used for headlines/stats/price on the master);
// `font: "body"` = Noto Sans (used for paragraph copy, the perks list, and
// contact details on the master).
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
        geometry: { top: 8.43, left: 120.74, width: 400, height: 64.93 },
        style: { fontSize: 25.33, fontWeight: "bold", color: "#ffffff", textAlign: "center", decoration: "underline", font: "heading" },
      },
      {
        key: "headlineLine1",
        type: "text",
        role: "Headline, line 1 — short punchy lead-in (e.g. property type).",
        matchText: "Holiday House",
        source: "jean", // no reliable "property type" field scraped from StockNetwork — typed in, same as promo/price/dates.
        geometry: { top: 65.3, left: 225.4, width: 429.71, height: 85.4 },
        style: { fontSize: 71.33, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
      },
      {
        key: "headlineLine2",
        type: "text",
        role: "Headline, line 2 — usually the destination/area, e.g. \"In <Town>!\"",
        matchText: "In Plett!",
        source: "stocknetwork+jean", // built from the hook's own Location picker (locationLabel) — real data Jean selected, not invented.
        geometry: { top: 149.36, left: 312, width: 564.16, height: 73.75 },
        style: { fontSize: 62, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
      },
      {
        key: "priceBadge",
        type: "text",
        role: "Price badge — two lines: the headline rate, then a per-person/qualifier line.",
        matchText: "R3500 PER DAY\nUnder R600 p/p",
        source: "jean", // confirmed in automated-flyer-form-spec.md: StockNetwork's ResortInfo page carries no static rate — price is dates-dependent and lives in the booking/rate engine, not a resort field. Never invented; always typed in.
        geometry: { top: 203.79, left: 110.01, width: 158.69, height: 150.4 },
        style: { fontSize: 28, fontWeight: "bold", color: "#ffde59", textAlign: "center", font: "heading" },
      },
      {
        key: "keyStat",
        type: "text",
        role: "Big single stat under the headline — usually sleeps/occupancy count.",
        matchText: "6 Sleeper",
        source: "stocknetwork", // from the scraped Room Type field.
        geometry: { top: 475.4, left: 82.38, width: 414.86, height: 73.6 },
        style: { fontSize: 62, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "heading" },
      },
      {
        key: "propertyNameArea",
        type: "text",
        role: "Property name and area, e.g. \"<Resort Name> • <Suburb/Town>\".",
        matchText: "The Dunes Resort & Hotel • Keurboomstrand",
        source: "stocknetwork",
        geometry: { top: 433, left: 82, width: 480, height: 18.8 },
        style: { fontSize: 16, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
      },
      {
        key: "dateRange",
        type: "text",
        role: "Availability/stay window for the promo, e.g. peak-season dates and length of stay.",
        matchText: "18 December to 1 January – Peak Season Stay (14 Days)",
        source: "jean",
        geometry: { top: 567, left: 82, width: 460, height: 18.8 },
        style: { fontSize: 16, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
      },
      {
        key: "description",
        type: "text",
        role: "Main body paragraph — room configuration, key amenities, walking distance to notable features.",
        matchText:
          "2 Spacious Bedrooms | 2 Modern Bathrooms. Fully Equipped Self-Catering Kitchen & Open-Plan Living (4 adults 2 kids under 12). Enclosed Private Garden & Shaded Patio with Built-In Braai. 3-min Walk to Private Beach, Wooden Decks & Ocean-side Picnic Spots.",
        source: "stocknetwork", // the property's own scraped "About" text, used as-is — never rewritten or embellished.
        geometry: { top: 594.61, left: 87.72, width: 530.72, height: 322.13 },
        style: { fontSize: 22, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "body" }, // fontSize trimmed from the master's 29.3 — real scraped paragraphs run longer than the placeholder text, see hook-flyer-svg.js's wrap/shrink-to-fit.
      },
      {
        key: "sectionHeading",
        type: "text",
        role: "Heading over the amenities list, e.g. \"<Resort> Perks Included\".",
        matchText: "Resort Perks Included",
        source: "stocknetwork+jean",
        geometry: { top: 941.79, left: 82.38, width: 480, height: 32.72 },
        style: { fontSize: 28, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "body" },
      },
      {
        key: "amenity1",
        type: "text",
        role: "Amenity bullet 1.",
        matchText: "2 Sparkling Pools and Beach Access ",
        source: "stocknetwork",
        geometry: { top: 1008.72, left: 144.26, width: 352.98, height: 57.47 },
        style: { fontSize: 22.67, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "body" },
      },
      {
        key: "amenity2",
        type: "text",
        role: "Amenity bullet 2.",
        matchText: "24/7 Gated Security, Private Parking",
        source: "stocknetwork",
        geometry: { top: 1062.07, left: 144.26, width: 352.98, height: 57.47 },
        style: { fontSize: 22.67, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "body" },
      },
      {
        key: "amenity3",
        type: "text",
        role: "Amenity bullet 3.",
        matchText: "High-Speed Wi-Fi, Cafe & Laundromat",
        source: "stocknetwork",
        geometry: { top: 1115.42, left: 144.26, width: 352.98, height: 57.47 },
        style: { fontSize: 22.67, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "body" },
      },
      {
        key: "contactLabel",
        type: "text",
        role: "Small label above the contact phone number, e.g. \"Contact us\".",
        matchText: "Contact us",
        source: "fixed", // brand copy, same on every flyer — not per-property.
        geometry: { top: 1217.16, left: 191.61, width: 144.86, height: 27.39 },
        style: { fontSize: 23, fontWeight: "normal", color: "#ffffff", textAlign: "start", font: "body" },
      },
      {
        key: "contactPhone",
        type: "text",
        role: "Contact phone number.",
        matchText: "071 605 0055",
        // Has an account-wide default (the shared "Flyer contact info" box,
        // admin-managed) but CAN be overridden per hook — different hooks
        // are sometimes serviced by different people, and whoever actually
        // manages a given hook (admin, or the affiliate on their own Hub
        // page) needs to be able to put their own number/email on it. See
        // lib/hook-flyer.js's resolvePropertyFlyerFields for the fallback
        // (hook's own flyerContactPhone/flyerContactEmail, else the shared
        // setting) and admin-api.js/hook-api.js's saveFlyerContact action
        // for where a per-hook override is actually persisted.
        source: "jean-settings-override",
        geometry: { top: 1244.55, left: 191.61, width: 260.74, height: 37.73 },
        style: { fontSize: 28, fontWeight: "bold", color: "#ffffff", textAlign: "start", font: "body" },
      },
      {
        key: "contactEmail",
        type: "text",
        role: "Contact email address.",
        matchText: "marketing@avantehospitality.co.za",
        source: "jean-settings-override",
        geometry: { top: 1290, left: 191, width: 290, height: 18.8 },
        style: { fontSize: 14, fontWeight: "normal", color: "#ffffff", textAlign: "start", font: "body" },
      },
    ],
    // Image fields — geometry is each photo's real box on the flyer
    // (rect for heroImage, a circle inscribed in the box for the two
    // insets). A generated flyer fills each box with one of the hook's own
    // saved photos using a "cover" crop (fills the box, centered, no
    // stretching) — never a stand-in stock image — and simply leaves the
    // box empty if the hook doesn't have that many photos saved yet, rather
    // than reusing or duplicating one.
    images: [
      {
        key: "heroImage",
        role: "Large hero photo filling the right-hand panel of the flyer.",
        shape: "rect",
        geometry: { top: 476.61, left: 623.92, width: 456.08, height: 869.39 },
      },
      {
        key: "featureImage",
        role: "Upper circular inset photo — a wide/establishing shot (e.g. beach, coastline, grounds).",
        shape: "circle",
        geometry: { top: -80.98, left: 574.46, width: 678.27, height: 678.27 },
      },
      {
        key: "lifestyleImage",
        role: "Lower circular inset photo — an interior/amenity close-up (e.g. kitchen, living area).",
        // Corrected this round: the master's actual photo element for this
        // slot is the smaller inset circle (see chrome's lifestyleBacking
        // for the larger teal circle sitting behind it) — a prior capture
        // of this registry pointed at that backing circle's geometry
        // instead of the photo itself.
        shape: "circle",
        geometry: { top: 476.61, left: 659.52, width: 345.47, height: 345.47 },
      },
    ],
    // Brand chrome — decorative shapes, icons, and the logo — drawn on
    // every flyer exactly as captured, never touched per-property.
    // `pathShape` entries carry the Canva shape's own path `d` plus the
    // viewBox it's defined in, so hook-flyer-svg.js can place it exactly
    // (translate+scale from that viewBox onto `geometry`) without needing
    // any special-casing per shape.
    chrome: {
      // Two overlapping full-bleed circles behind the hero photo panel.
      backdropCircles: [
        { geometry: { top: -109.68, left: 540, width: 763.25, height: 763.25 }, color: "#0e2f44" },
        { geometry: { top: -109.68, left: 574.46, width: 763.25, height: 763.25 }, color: "#0dcdc2" },
      ],
      // The teal circle sitting behind/around the lifestyle inset photo.
      lifestyleBacking: { geometry: { top: 450.42, left: 633.32, width: 397.86, height: 397.86 }, color: "#0dcdc2" },
      // Promo-tag pill background (top banner).
      promoTagBanner: { geometry: { top: 6.3, left: 82, width: 480, height: 71.51 }, color: "#0dcdc2", rx: 20 },
      // Rounded diamond/badge sitting behind the price badge text.
      priceBadge: {
        geometry: { top: 174.72, left: 87.72, width: 209.28, height: 209.28 },
        color: "#0e2f44",
        pathShape: { viewBox: { width: 64, height: 64 }, d: "M57.7466 0H6.25339C6.25339 3.44086 3.47078 6.25339 0 6.25339V57.7466C3.44086 57.7466 6.25339 60.5292 6.25339 64H57.7466C57.7466 60.5591 60.5292 57.7466 64 57.7466V6.25339C60.5591 6.25339 57.7466 3.47078 57.7466 0Z" },
      },
      // The three amenity check-mark icons — same fixed glyph, recolored,
      // one per amenity row.
      amenityIcons: [
        { geometry: { top: 1007.68, left: 82.38, width: 36.62, height: 36.62 } },
        { geometry: { top: 1061.03, left: 82.38, width: 36.62, height: 36.62 } },
        { geometry: { top: 1114.39, left: 82.38, width: 36.62, height: 36.62 } },
      ],
      amenityIconColor: "#6bb2e3",
      // Contact block background (navy rounded panel, bottom-left) and its
      // phone icon.
      contactBlock: { geometry: { top: 1196.01, left: 82.38, width: 414.86, height: 150 }, color: "#0e2f44", rx: 24 },
      contactPhoneIcon: { geometry: { top: 1217.16, left: 108.94, width: 65.12, height: 65.12 }, color: "#ffffff" },
      // The Avante Travel logo (top-left). No raster copy of the real logo
      // graphic is bundled here (Canva's own asset CDN isn't reachable at
      // generation time) — rendered as a typeset wordmark in the exact same
      // box/brand colors instead. Swap in a real logo file whenever Jean
      // can supply one; see flyer-generation-button-scope.md.
      logo: { geometry: { top: 65.3, left: 35.95, width: 128.1, height: 84.06 }, textFallback: { line1: "AVANTE", line2: "TRAVEL", color: "#0dcdc2" } },
    },
    // Elements on the master that are brand chrome, not per-flyer content —
    // rendered from the `chrome` block above, untouched per-property.
    notEditable: ["brand logo", "amenity check icons", "phone icon", "decorative shapes"],
  },
};

// -----------------------------------------------------------------------
// Template: event-flyer-v1
// -----------------------------------------------------------------------
// Source design: Jean's "AVANTE BLANK EVENT TEMPLATE — reference only
// (descriptions)" (Canva design id below, linked via
// https://canva.link/ijooqoifg3f5g98). Category: a standalone event/
// festival promo (e.g. the Hermanus Whale Festival) — not tied to any one
// property, so unlike property-flyer-v1 nothing here comes from
// StockNetwork; every field is typed in directly (source: "jean"), same
// "nothing invented, blank if unknown" rule as everywhere else in this app.
//
// This master design is itself a labeled reference/wireframe rather than a
// filled example (its own title says so) — every text element's captured
// content below ("EVENT NAME — line 1", "HIGHLIGHT 1 — short activity or
// feature", etc.) is an instructional label, not real example copy, so it's
// used here purely as matchText/role documentation of what each box is for,
// exactly like property-flyer-v1 already does with its own captured
// matchText. Two small floating text elements in the source design merely
// label where the two photo circles are ("HERO IMAGE — main event photo",
// "SECONDARY IMAGE — supporting photo") — those are guidance for a human
// reading the reference design and are intentionally left out of `fields`/
// `chrome` below; they never render on a generated flyer.
//
// Three distinct Canva font references are used across this design's text
// (fontRef ids only — Canva's API doesn't hand back a resolvable font
// family name here). Rather than guess three different real fonts, each is
// mapped onto the same two already-loaded brand fonts property-flyer-v1
// uses — large/display-scale text (event name lines, location name) →
// "heading" (Montserrat); everything else (subtitle, section heading,
// highlights, date, location detail) → "body" (Noto Sans) — a disclosed
// approximation, flagged here the same way the logo swap was on
// property-flyer-v1. Colors, sizes, weights and every geometry number below
// are the real captured values from the design, unchanged.
//
// canvasSize is this design's own real page size (794x1123 — different
// proportions than property-flyer-v1's 1080x1350, which is fine:
// hook-flyer-svg.js sizes its SVG viewBox per-template).
export const EVENT_TEMPLATE_V1 = {
  category: "event",
  label: "Event / festival flyer",
  masterDesignId: "DAHV6Dr6wAQ",
  canvasSize: { width: 794, height: 1123 },
  fields: [
    {
      key: "eventNameLine1",
      type: "text",
      role: "Event name — line 1.",
      matchText: "EVENT NAME — line 1",
      source: "jean",
      geometry: { top: 180.81, left: 60.98, width: 353.32, height: 35.53 },
      style: { fontSize: 30, fontWeight: "normal", color: "#8c97a3", textAlign: "start", font: "heading" },
    },
    {
      key: "eventNameLine2",
      type: "text",
      role: "Event name — line 2 / tagline.",
      matchText: "EVENT NAME — line 2 / tagline",
      source: "jean",
      geometry: { top: 277.5, left: 60.98, width: 335.87, height: 27.99 },
      style: { fontSize: 24, fontWeight: "normal", color: "#8c97a3", textAlign: "start", font: "heading" },
    },
    {
      key: "eventSubtitle",
      type: "text",
      role: "One-line hook describing the event.",
      matchText: "SUBTITLE — one-line hook describing the event",
      source: "jean",
      geometry: { top: 402.16, left: 60.98, width: 353.32, height: 51.9 },
      style: { fontSize: 20, fontWeight: "bold", color: "#8c97a3", textAlign: "start", font: "body" },
    },
    {
      key: "eventSectionHeading",
      type: "text",
      role: "Heading above the highlights list, e.g. \"Highlights\".",
      matchText: "SECTION HEADING — e.g. Highlights",
      source: "jean",
      geometry: { top: 594.28, left: 60.98, width: 274.48, height: 51.63 },
      style: { fontSize: 20, fontWeight: "bold", color: "#c9d2da", textAlign: "start", font: "body" },
    },
    {
      key: "eventHighlight1",
      type: "text",
      role: "Highlight / activity bullet 1.",
      matchText: "HIGHLIGHT 1 — short activity or feature",
      source: "jean",
      geometry: { top: 650.89, left: 93.93, width: 289.3, height: 40.13 },
      style: { fontSize: 16, fontWeight: "normal", color: "#c9d2da", textAlign: "start", font: "body" },
    },
    {
      key: "eventHighlight2",
      type: "text",
      role: "Highlight / activity bullet 2.",
      matchText: "HIGHLIGHT 2",
      source: "jean",
      geometry: { top: 691.39, left: 93.93, width: 161.35, height: 18.47 },
      style: { fontSize: 16, fontWeight: "normal", color: "#c9d2da", textAlign: "start", font: "body" },
    },
    {
      key: "eventHighlight3",
      type: "text",
      role: "Highlight / activity bullet 3.",
      matchText: "HIGHLIGHT 3",
      source: "jean",
      geometry: { top: 731.88, left: 93.93, width: 166.77, height: 18.47 },
      style: { fontSize: 16, fontWeight: "normal", color: "#c9d2da", textAlign: "start", font: "body" },
    },
    {
      key: "eventHighlight4",
      type: "text",
      role: "Highlight / activity bullet 4.",
      matchText: "HIGHLIGHT 4",
      source: "jean",
      geometry: { top: 774.34, left: 93.93, width: 211.21, height: 18.47 },
      style: { fontSize: 16, fontWeight: "normal", color: "#c9d2da", textAlign: "start", font: "body" },
    },
    {
      key: "eventDate",
      type: "text",
      role: "Event date(s).",
      matchText: "DATE — event date(s)",
      source: "jean",
      geometry: { top: 869.9, left: 140.96, width: 308.13, height: 21.4 },
      style: { fontSize: 18, fontWeight: "bold", color: "#c9d2da", textAlign: "start", font: "body" },
    },
    {
      key: "eventLocationName",
      type: "text",
      role: "Location name — town/area, e.g. \"Hermanus\".",
      matchText: "LOCATION NAME",
      source: "jean", // Jean types this; may match a town/suburb from the same Browse-by-location tree used elsewhere, but there's no automatic link (yet) the way property-flyer-v1's headlineLine2 has.
      geometry: { top: 956.85, left: 124.55, width: 278.46, height: 30.8 },
      style: { fontSize: 26, fontWeight: "normal", color: "#c9d2da", textAlign: "start", font: "heading" },
    },
    {
      key: "eventLocationDetail",
      type: "text",
      role: "Location detail — venue name, address, or region.",
      matchText: "LOCATION DETAIL — address or region",
      source: "jean",
      geometry: { top: 1001.64, left: 124.55, width: 342.36, height: 18.8 },
      style: { fontSize: 16, fontWeight: "bold", color: "#c9d2da", textAlign: "start", font: "body" },
    },
  ],
  // Two circular photo slots (the design's "HERO IMAGE"/"SECONDARY IMAGE"
  // labeled circles — see note above on why those floating labels
  // themselves aren't part of this registry). A generated flyer fills each
  // from this hook's own saved photos, cover-first, exactly like
  // property-flyer-v1 — an empty slot is left visibly empty, never
  // duplicated or reused, never a stand-in stock photo.
  images: [
    {
      key: "heroImage",
      role: "Large circular hero photo — the main event photo.",
      shape: "circle",
      geometry: { top: 212.08, left: 424.62, width: 542.65, height: 542.65 },
    },
    {
      key: "secondaryImage",
      role: "Smaller circular supporting photo, overlapping the hero circle.",
      shape: "circle",
      geometry: { top: 63.5, left: 424.62, width: 339.33, height: 339.33 },
    },
  ],
  // Brand chrome — decorative shapes, icons, and the logo — drawn on every
  // event flyer exactly as captured, never touched per-event.
  chrome: {
    backgroundColor: "#0e2f44",
    // Two large soft off-canvas circles peeking in at the top-left corner.
    backdropCircles: [
      { geometry: { top: -149.73, left: -103.02, width: 710.99, height: 710.99 }, color: "#cdaf6f" },
      { geometry: { top: -180.0, left: -144.48, width: 710.99, height: 710.99 }, color: "#e1e1e0" },
    ],
    // The master's "wave motif" — four large rotated organic swirl shapes
    // (two gold, two gray) built from a Canva-hosted image mask that isn't
    // reachable at flyer-generation time (same asset-access limit
    // property-flyer-v1's logo hit). Approximated here as soft rotated
    // blobs in the same two brand colors, at the same bounding geometry and
    // rotation, rather than left out entirely — a disclosed simplification,
    // not the exact source artwork.
    waveShapes: [
      { geometry: { top: 456.25, left: 412.12, width: 810.1, height: 762.5 }, rotation: 133.01, color: "#cdaf6f" },
      { geometry: { top: -201.17, left: 650.37, width: 592.64, height: 557.82 }, rotation: 115.84, color: "#cdaf6f" },
      { geometry: { top: 490.7, left: 443.0, width: 810.1, height: 762.5 }, rotation: 133.01, color: "#e1e1e0" },
      { geometry: { top: -183.76, left: 679.39, width: 592.64, height: 557.82 }, rotation: 115.84, color: "#e1e1e0" },
    ],
    heroStroke: { color: "#ffffff", weight: 20 },
    secondaryStroke: { color: "#ffffff", weight: 17 },
    // Four small check-mark icons, one beside each highlight bullet.
    highlightIcons: [
      { geometry: { top: 651.72, left: 60.98, width: 27.03, height: 27.03 } },
      { geometry: { top: 692.21, left: 60.98, width: 27.03, height: 27.03 } },
      { geometry: { top: 732.7, left: 60.98, width: 27.03, height: 27.03 } },
      { geometry: { top: 775.16, left: 60.98, width: 27.03, height: 27.03 } },
    ],
    highlightIconColor: "#ffffff",
    highlightIconBg: "#5b612f",
    // Calendar icon beside the date line, location-pin icon beside the
    // location name/detail lines. No raster copy of the real glyph icons is
    // bundled here (same Canva-asset-CDN limit as everywhere else) —
    // rendered as simple drawn glyphs in the captured box/color instead.
    dateIcon: { geometry: { top: 854.73, left: 60.98, width: 66.92, height: 66.92 }, color: "#ffffff" },
    locationIcon: { geometry: { top: 962.96, left: 60.98, width: 52.9, height: 69.15 }, color: "#ffffff" },
    // Avante Travel logo (top-left) — same typeset-wordmark fallback as
    // property-flyer-v1, for the same reason (no reachable logo asset at
    // generation time); swap in a real logo file whenever Jean can supply
    // one.
    logo: { geometry: { top: 8.84, left: 40.45, width: 170.57, height: 116.97 }, textFallback: { line1: "AVANTE", line2: "TRAVEL", color: "#0dcdc2" } },
  },
  notEditable: ["brand logo", "wave motif shapes", "backdrop circles", "highlight check icons", "date icon", "location pin icon"],
};

// Registers event-flyer-v1 alongside property-flyer-v1 in the same lookup
// table used everywhere else in this file.
HOOK_TEMPLATES["event-flyer-v1"] = EVENT_TEMPLATE_V1;

// -----------------------------------------------------------------------
// Templates: place-guide-v1 / town-region-v1
// -----------------------------------------------------------------------
// Source design: the same 3-page Canva template Jean linked for the new
// landing-page feature (2026-09-23) — "AVANTE 3-PAGE FLYER — BLANK
// TEMPLATE", design id DAHWA3gbEGo (https://canva.link/3qtbmt7ijkc2sv3).
// Page 1 of that design is (near-exactly) property-flyer-v1 above, already
// built — these are pages 2 ("Place!") and 3 ("Town! & Region"), captured
// the same way (an editing-transaction read of the real design's own
// element geometry), registered here for the landing page builder Jean
// asked for, NOT yet wired into any renderer.
//
// Two things are deliberately left open pending Jean's confirmation before
// any UI is built on top of these (see the project doc this round's work
// was written up in):
//
// 1. Whether the landing page renders these as a fixed-size graphic (the
//    same SVG approach hook-flyer-svg.js uses for the existing flyers) or
//    as flowing, responsive HTML (the way hook-landing.html works today).
//    This registry's geometry supports either — it's just captured
//    positions/sizes — but only the SVG path would use it directly.
// 2. The `heading`/`headingLine2` fields below (the design's floating
//    "HEADING" text sitting above the fixed "PLACE!"/"TOWN!" page label)
//    have no filled real-world example to check against — only Jean's own
//    blank/labeled template. matchText below is the literal placeholder
//    text captured from the design; `role` documents my best reading of
//    what each field is for, not a confirmed answer.
//
// `nearby`/`dayTrip` one-line fields and the `attraction`/`adventure`
// name+description+photo blocks are sourced from Map & Activities entries
// matched by real distance (lib/geo-distance.js's nearestByDistance) —
// never typed or invented. Page 2 is meant for the closest matches, page 3
// for the next-closest ("day trips") — see the project doc for the
// near/far split this assumes, pending Jean's confirmation.
const PLACE_GUIDE_TEMPLATE_V1 = {
  category: "place-guide",
  label: "Landing page — Place! (nearby activities)",
  masterDesignId: "DAHWA3gbEGo",
  masterDesignPage: 2,
  canvasSize: { width: 1080, height: 1350 },
  fields: [
    {
      key: "sectionBanner",
      type: "text",
      role: "Small pill banner above the heading — short label/promo text, same slot as property-flyer-v1's promoTag.",
      matchText: "SECTION BANNER",
      source: "jean",
      geometry: { top: 22, left: 82, width: 480, height: 33.4 },
      style: { fontSize: 28, fontWeight: "bold", color: "#ffffff", textAlign: "center", font: "heading" },
    },
    {
      key: "heading",
      type: "text",
      role: "Large heading above the fixed \"PLACE!\" label — reading (best guess, unconfirmed) as the area/town name, e.g. \"KEURBOOMS\".",
      matchText: "HEADING",
      source: "stocknetwork+jean",
      geometry: { top: 65, left: 200, width: 380, height: 81.4 },
      style: { fontSize: 68, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "subheading",
      type: "text",
      role: "Italic subheading below \"PLACE!\" — a short tagline for the area.",
      matchText: "SUBHEADING",
      source: "jean",
      geometry: { top: 250, left: 82, width: 450, height: 40.2 },
      style: { fontSize: 34, fontWeight: "bold", fontStyle: "italic", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "nearbyActivity1",
      type: "text",
      role: "Nearby-activity one-liner 1 (name + at-a-glance detail).",
      matchText: "NEARBY ACTIVITY 1 – one short line",
      source: "map-activities-nearest",
      geometry: { top: 318, left: 122, width: 410, height: 27.4 },
      style: { fontSize: 23, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "nearbyActivity2",
      type: "text",
      role: "Nearby-activity one-liner 2.",
      matchText: "NEARBY ACTIVITY 2 – one short line",
      source: "map-activities-nearest",
      geometry: { top: 388, left: 122, width: 410, height: 27.4 },
      style: { fontSize: 23, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "nearbyActivity3",
      type: "text",
      role: "Nearby-activity one-liner 3.",
      matchText: "NEARBY ACTIVITY 3 – one short line",
      source: "map-activities-nearest",
      geometry: { top: 458, left: 122, width: 410, height: 27.4 },
      style: { fontSize: 23, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "resortLine",
      type: "text",
      role: "\"RESORT NAME • AREA\" line — same locationLabel construction as property-flyer-v1's headlineLine2.",
      matchText: "RESORT NAME • AREA",
      source: "stocknetwork+jean",
      geometry: { top: 560, left: 82, width: 450, height: 21.4 },
      style: { fontSize: 18, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
    },
    {
      key: "attraction1Name",
      type: "text",
      role: "Attraction 1 name.",
      matchText: "ATTRACTION 1 NAME",
      source: "map-activities-nearest",
      geometry: { top: 955, left: 82, width: 440, height: 36 },
      style: { fontSize: 30, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "attraction1Description",
      type: "text",
      role: "Attraction 1 — one sentence: what it is, why guests will love it, how far from the property (distance comes from lib/geo-distance.js, never typed).",
      matchText: "One sentence: what it is, why guests will love it, and how far it is from the property.",
      source: "map-activities-nearest",
      geometry: { top: 1000, left: 82, width: 440, height: 55.6 },
      style: { fontSize: 22, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
    },
    {
      key: "attraction2Name",
      type: "text",
      role: "Attraction 2 name.",
      matchText: "ATTRACTION 2 NAME",
      source: "map-activities-nearest",
      geometry: { top: 955, left: 558, width: 440, height: 36 },
      style: { fontSize: 30, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "attraction2Description",
      type: "text",
      role: "Attraction 2 — same one-sentence shape as attraction1Description.",
      matchText: "One sentence: what it is, why guests will love it, and how far it is from the property.",
      source: "map-activities-nearest",
      geometry: { top: 1000, left: 558, width: 440, height: 55.6 },
      style: { fontSize: 22, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
    },
    {
      key: "contactLabel",
      type: "text",
      role: "Fixed \"Contact us\" label, same as property-flyer-v1.",
      matchText: "LABEL",
      source: "fixed",
      geometry: { top: 1217, left: 120, width: 340, height: 27.4 },
      style: { fontSize: 23, fontWeight: "normal", color: "#ffffff", textAlign: "start", font: "body" },
    },
    {
      key: "contactPhone",
      type: "text",
      role: "Contact phone — same shared/override source as property-flyer-v1.",
      matchText: "PHONE NUMBER",
      source: "jean-settings-override",
      geometry: { top: 1245, left: 120, width: 340, height: 37.6 },
      style: { fontSize: 32, fontWeight: "bold", color: "#ffffff", textAlign: "start", font: "heading" },
    },
    {
      key: "contactEmail",
      type: "text",
      role: "Contact email — same shared/override source as property-flyer-v1.",
      matchText: "EMAIL ADDRESS",
      source: "jean-settings-override",
      geometry: { top: 1290, left: 120, width: 340, height: 18.8 },
      style: { fontSize: 16, fontWeight: "normal", color: "#ffffff", textAlign: "start", font: "body" },
    },
    {
      key: "ctaDates",
      type: "text",
      role: "Call to action + dates banner — same typed flyerDates/CTA source as the existing flyers.",
      matchText: "CALL TO ACTION + DATES",
      source: "jean",
      geometry: { top: 1245, left: 558, width: 440, height: 36 },
      style: { fontSize: 30, fontWeight: "bold", color: "#ffffff", textAlign: "center", font: "heading" },
    },
  ],
  images: [
    { key: "areaImage", role: "Area/coastline photo, upper right.", shape: "circle", geometry: { top: 100, left: 610, width: 420, height: 420 } },
    { key: "attraction1Image", role: "Attraction 1 photo.", shape: "rect", geometry: { top: 680, left: 82, width: 440, height: 250 } },
    { key: "attraction2Image", role: "Attraction 2 photo.", shape: "rect", geometry: { top: 680, left: 558, width: 440, height: 250 } },
  ],
  chrome: {
    backdropCircles: [
      { geometry: { top: -110, left: 540, width: 763, height: 763 }, color: "#0e2f44" },
      { geometry: { top: -110, left: 574, width: 763, height: 763 }, color: "#0dcdc2" },
    ],
    sectionBannerPill: { geometry: { top: 6, left: 82, width: 480, height: 72 }, color: "#0dcdc2", rx: 24 },
    contactBlock: { geometry: { top: 1196, left: 82, width: 415, height: 150 }, color: "#0e2f44", rx: 24 },
    ctaPill: { geometry: { top: 1215, left: 558, width: 440, height: 100 }, color: "#0dcdc2", rx: 32 },
    dividerBars: [
      { geometry: { top: 930, left: 82, width: 440, height: 8 }, color: "#0dcdc2" },
      { geometry: { top: 930, left: 558, width: 440, height: 8 }, color: "#0dcdc2" },
    ],
    // Fixed page label — "PLACE!" — part of the design's own section
    // branding, not per-hook content. Rendered exactly as captured.
    pageLabel: { text: "PLACE!", geometry: { top: 149, left: 200, width: 380, height: 66.8 }, style: { fontSize: 56, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" } },
    logo: { geometry: { top: 65, left: 36, width: 128, height: 84 }, textFallback: { line1: "AVANTE", line2: "TRAVEL", color: "#0dcdc2" } },
  },
  notEditable: ["brand logo", "backdrop circles", "divider bars", "\"PLACE!\" page label"],
};
HOOK_TEMPLATES["place-guide-v1"] = PLACE_GUIDE_TEMPLATE_V1;

const TOWN_REGION_TEMPLATE_V1 = {
  category: "town-region",
  label: "Landing page — Town! & Region (day trips)",
  masterDesignId: "DAHWA3gbEGo",
  masterDesignPage: 3,
  canvasSize: { width: 1080, height: 1350 },
  fields: [
    {
      key: "sectionBanner",
      type: "text",
      role: "Small pill banner above the heading — same slot as place-guide-v1's sectionBanner.",
      matchText: "SECTION BANNER",
      source: "jean",
      geometry: { top: 22, left: 82, width: 480, height: 33.4 },
      style: { fontSize: 28, fontWeight: "bold", color: "#ffffff", textAlign: "center", font: "heading" },
    },
    {
      key: "heading",
      type: "text",
      role: "Large heading above the fixed \"TOWN!\" / \"& REGION\" labels — reading (best guess, unconfirmed) as the wider region name, e.g. \"GARDEN ROUTE\".",
      matchText: "HEADING",
      source: "stocknetwork+jean",
      geometry: { top: 65, left: 200, width: 380, height: 81.4 },
      style: { fontSize: 68, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "dayTrip1",
      type: "text",
      role: "Day trip 1 — name + drive time (distance comes from lib/geo-distance.js's straight-line estimate, never a real drive time — see that file's own note on the distinction).",
      matchText: "DAY TRIP 1 – name + drive time",
      source: "map-activities-farther",
      geometry: { top: 318, left: 122, width: 410, height: 27.4 },
      style: { fontSize: 23, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "dayTrip2",
      type: "text",
      role: "Day trip 2.",
      matchText: "DAY TRIP 2 – name + drive time",
      source: "map-activities-farther",
      geometry: { top: 388, left: 122, width: 410, height: 27.4 },
      style: { fontSize: 23, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "dayTrip3",
      type: "text",
      role: "Day trip 3.",
      matchText: "DAY TRIP 3 – name + drive time",
      source: "map-activities-farther",
      geometry: { top: 458, left: 122, width: 410, height: 27.4 },
      style: { fontSize: 23, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "distanceNote",
      type: "text",
      role: "Short reassurance line, e.g. \"All an easy drive from [area]\".",
      matchText: "DISTANCE NOTE – e.g. All an easy drive from [area]",
      source: "jean",
      geometry: { top: 560, left: 82, width: 450, height: 21.4 },
      style: { fontSize: 18, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
    },
    {
      key: "adventure1Name",
      type: "text",
      role: "Adventure 1 name.",
      matchText: "ADVENTURE 1 NAME",
      source: "map-activities-farther",
      geometry: { top: 955, left: 82, width: 440, height: 36 },
      style: { fontSize: 30, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "adventure1Description",
      type: "text",
      role: "Adventure 1 — one sentence: the experience, where it leaves from, roughly how far away.",
      matchText: "One sentence: the experience, where it leaves from, and roughly how far away.",
      source: "map-activities-farther",
      geometry: { top: 1000, left: 82, width: 440, height: 55.6 },
      style: { fontSize: 22, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
    },
    {
      key: "adventure2Name",
      type: "text",
      role: "Adventure 2 name.",
      matchText: "ADVENTURE 2 NAME",
      source: "map-activities-farther",
      geometry: { top: 955, left: 558, width: 440, height: 36 },
      style: { fontSize: 30, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" },
    },
    {
      key: "adventure2Description",
      type: "text",
      role: "Adventure 2 — same one-sentence shape as adventure1Description.",
      matchText: "One sentence: the experience, where it leaves from, and roughly how far away.",
      source: "map-activities-farther",
      geometry: { top: 1000, left: 558, width: 440, height: 55.6 },
      style: { fontSize: 22, fontWeight: "normal", color: "#0e2f44", textAlign: "start", font: "body" },
    },
    {
      key: "contactLabel",
      type: "text",
      role: "Fixed \"Contact us\" label.",
      matchText: "LABEL",
      source: "fixed",
      geometry: { top: 1217, left: 120, width: 340, height: 27.4 },
      style: { fontSize: 23, fontWeight: "normal", color: "#ffffff", textAlign: "start", font: "body" },
    },
    {
      key: "contactPhone",
      type: "text",
      role: "Contact phone — shared/override source, same as everywhere else.",
      matchText: "PHONE NUMBER",
      source: "jean-settings-override",
      geometry: { top: 1245, left: 120, width: 340, height: 37.6 },
      style: { fontSize: 32, fontWeight: "bold", color: "#ffffff", textAlign: "start", font: "heading" },
    },
    {
      key: "contactEmail",
      type: "text",
      role: "Contact email — shared/override source, same as everywhere else.",
      matchText: "EMAIL ADDRESS",
      source: "jean-settings-override",
      geometry: { top: 1290, left: 120, width: 340, height: 18.8 },
      style: { fontSize: 16, fontWeight: "normal", color: "#ffffff", textAlign: "start", font: "body" },
    },
    {
      key: "ctaDates",
      type: "text",
      role: "Call to action + dates banner.",
      matchText: "CALL TO ACTION + DATES",
      source: "jean",
      geometry: { top: 1245, left: 558, width: 440, height: 36 },
      style: { fontSize: 30, fontWeight: "bold", color: "#ffffff", textAlign: "center", font: "heading" },
    },
  ],
  images: [
    { key: "townImage", role: "Town/aerial photo, upper right.", shape: "circle", geometry: { top: 100, left: 610, width: 420, height: 420 } },
    { key: "adventure1Image", role: "Adventure 1 photo.", shape: "rect", geometry: { top: 680, left: 82, width: 440, height: 250 } },
    { key: "adventure2Image", role: "Adventure 2 photo.", shape: "rect", geometry: { top: 680, left: 558, width: 440, height: 250 } },
  ],
  chrome: {
    backdropCircles: [
      { geometry: { top: -110, left: 540, width: 763, height: 763 }, color: "#0e2f44" },
      { geometry: { top: -110, left: 574, width: 763, height: 763 }, color: "#0dcdc2" },
    ],
    sectionBannerPill: { geometry: { top: 6, left: 82, width: 480, height: 72 }, color: "#0dcdc2", rx: 24 },
    contactBlock: { geometry: { top: 1196, left: 82, width: 415, height: 150 }, color: "#0e2f44", rx: 24 },
    ctaPill: { geometry: { top: 1215, left: 558, width: 440, height: 100 }, color: "#0dcdc2", rx: 32 },
    dividerBars: [
      { geometry: { top: 930, left: 82, width: 440, height: 8 }, color: "#0dcdc2" },
      { geometry: { top: 930, left: 558, width: 440, height: 8 }, color: "#0dcdc2" },
    ],
    // Fixed page labels — "TOWN!" and "& REGION" — part of the design's own
    // section branding, not per-hook content.
    pageLabel: { text: "TOWN!", geometry: { top: 149, left: 200, width: 380, height: 66.8 }, style: { fontSize: 56, fontWeight: "bold", color: "#0e2f44", textAlign: "start", font: "heading" } },
    pageLabel2: { text: "& REGION", geometry: { top: 250, left: 82, width: 450, height: 40.2 }, style: { fontSize: 34, fontWeight: "bold", fontStyle: "italic", color: "#0e2f44", textAlign: "start", font: "heading" } },
    logo: { geometry: { top: 65, left: 36, width: 128, height: 84 }, textFallback: { line1: "AVANTE", line2: "TRAVEL", color: "#0dcdc2" } },
  },
  notEditable: ["brand logo", "backdrop circles", "divider bars", "\"TOWN!\"/\"& REGION\" page labels"],
};
HOOK_TEMPLATES["town-region-v1"] = TOWN_REGION_TEMPLATE_V1;

// Look up a template by id. Returns undefined if unknown.
export function getHookTemplate(templateId) {
  return HOOK_TEMPLATES[templateId];
}

// The template a given hook category should use by default. "property"/
// "resort" (the original, still-default category) maps to the resort stay
// flyer; "event" maps to the new standalone event/festival flyer above.
export function defaultTemplateForCategory(category) {
  if (category === "event") return HOOK_TEMPLATES["event-flyer-v1"];
  if (category === "property" || category === "resort" || !category) return HOOK_TEMPLATES["property-flyer-v1"];
  return undefined;
}
