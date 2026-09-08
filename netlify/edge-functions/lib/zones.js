// The 8 affiliate zones (same scheme used for the earlier standalone
// zone-mapping deliverable: Garden Route grouped under Eastern Cape,
// Gauteng grouped with North West). Shared by the affiliate Zone field
// (admin-api.js's upsertAffiliate), the activity Zone field (map-api.js),
// and the Hub's Explore Map filter, so all three always offer the exact
// same list and can't drift out of sync.
export const ZONES = [
  "Western Cape (Cape Town & Winelands)",
  "Eastern Cape & Garden Route",
  "Northern Cape",
  "Free State",
  "KwaZulu-Natal",
  "Gauteng & North West",
  "Mpumalanga",
  "Limpopo",
];

// stateProvince on a property listing is free text typed by the property
// owner (property-form.html has no dropdown for it), so this matches by
// keyword rather than requiring an exact string — "Western Cape",
// "western cape", "W Cape" style variations all still resolve correctly.
// Returns "" (no confident match) rather than guessing.
export function provinceToZone(stateProvince) {
  const s = String(stateProvince || "").toLowerCase();
  if (!s) return "";
  if (s.includes("western cape") || s.includes("winelands")) return ZONES[0];
  if (s.includes("eastern cape") || s.includes("garden route")) return ZONES[1];
  if (s.includes("northern cape")) return ZONES[2];
  if (s.includes("free state")) return ZONES[3];
  if (s.includes("kwazulu") || s.includes("natal")) return ZONES[4];
  if (s.includes("gauteng") || s.includes("north west")) return ZONES[5];
  if (s.includes("mpumalanga")) return ZONES[6];
  if (s.includes("limpopo")) return ZONES[7];
  return "";
}
