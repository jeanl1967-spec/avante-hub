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

// Resort/activity district & town fields are place names, not provinces
// ("Cradock", "Plettenberg Bay", "Hazyview"), so provinceToZone's substring
// match against a province name won't fire for most of them. This is a
// best-effort town/region keyword table covering the major towns across
// all 9 provinces, including every town that appeared in the ~1,250-row
// activities dataset. Coverage is NOT exhaustive — StockNetwork's resort
// list has ~5,900 properties across many more small towns than are listed
// here, so plenty of rows will come back with zone "" (unmapped) rather
// than a guess. Unmapped just means "doesn't auto-filter into any zone
// tab" — it still shows up under "All zones".
const TOWN_ZONE_KEYWORDS = [
  [ZONES[0], ["cape town", "stellenbosch", "franschhoek", "paarl", "worcester", "robertson", "montagu", "ceres",
    "saldanha", "langebaan", "hermanus", "gansbaai", "bredasdorp", "arniston", "clanwilliam", "citrusdal",
    "malmesbury", "somerset west", "strand", "wellington", "swellendam", "riversdale", "riebeek",
    "durbanville", "constantia", "hout bay", "camps bay", "sea point", "muizenberg", "simon's town", "simons town"]],
  [ZONES[1], ["port elizabeth", "gqeberha", "east london", "jeffreys bay", "jeffrey's bay", "plettenberg bay",
    "plett", "knysna", "george", "mossel bay", "oudtshoorn", "graaff-reinet", "graaff reinet", "cradock",
    "queenstown", "komani", "port st johns", "coffee bay", "wilderness", "sedgefield", "storms river",
    "tsitsikamma", "addo", "grahamstown", "makhanda", "kariega", "uitenhage", "prince albert", "barkly east",
    "hogsback", "morgan bay", "chintsa", "kenton-on-sea", "kenton on sea"]],
  [ZONES[2], ["kimberley", "upington", "springbok", "richmond", "sutherland", "calvinia", "de aar",
    "kuruman", "colesberg", "kathu", "augrabies"]],
  [ZONES[3], ["bloemfontein", "clarens", "ficksburg", "bethlehem", "harrismith", "welkom", "parys",
    "golden gate", "fouriesburg", "ladybrand"]],
  [ZONES[4], ["durban", "pietermaritzburg", "ballito", "st lucia", "hluhluwe", "richards bay", "margate",
    "underberg", "dundee", "greytown", "newcastle", "umhlanga", "drakensberg", "zululand", "port shepstone",
    "scottburgh", "eshowe", "pongola"]],
  [ZONES[5], ["johannesburg", "pretoria", "soweto", "sandton", "hartbeespoort", "magaliesburg", "rustenburg",
    "sun city", "vanderbijlpark", "krugersdorp", "benoni", "centurion", "midrand", "vereeniging", "potchefstroom",
    "mahikeng", "mafikeng", "klerksdorp"]],
  [ZONES[6], ["nelspruit", "mbombela", "hazyview", "sabie", "graskop", "barberton", "white river",
    "kruger", "malelane", "komatipoort", "pilgrim's rest", "pilgrims rest", "dullstroom", "lydenburg"]],
  [ZONES[7], ["polokwane", "phalaborwa", "musina", "tzaneen", "louis trichardt", "makhado", "modimolle",
    "thohoyandou"]],
];

export function districtToZone(district) {
  const byProvince = provinceToZone(district);
  if (byProvince) return byProvince;
  const s = String(district || "").toLowerCase();
  if (!s) return "";
  for (const [zone, keywords] of TOWN_ZONE_KEYWORDS) {
    if (keywords.some((kw) => s.includes(kw))) return zone;
  }
  return "";
}
