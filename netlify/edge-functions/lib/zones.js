// The 12 affiliate zones. "Garden Route" (Stilbaai to Storms River mouth,
// including the Klein Karoo towns such as Oudtshoorn and De Rust) is its own
// zone, the Eastern Cape has its own name, and (2026-09-21, at Jean's request)
// the old "Western Cape (Cape Town & Winelands)" is split into Cape Town,
// Winelands and West Coast & Overberg, and "Gauteng & North West" into Gauteng
// and North West. Shared by the affiliate Zone field (admin-api.js's
// upsertAffiliate), the activity Zone field (map-api.js), and the Hub's
// Explore Map filter, so all three always offer the exact same list and can't
// drift out of sync.
import ZONE_SHAPES from "./zone-shapes.js";

export const ZONES = [
  "Cape Town",
  "Winelands",
  "West Coast & Overberg",
  "Garden Route",
  "Eastern Cape",
  "Northern Cape",
  "Free State",
  "KwaZulu-Natal",
  "Gauteng",
  "North West",
  "Mpumalanga",
  "Limpopo",
];

const Z = {
  CT: ZONES[0], WL: ZONES[1], WO: ZONES[2], GR: ZONES[3], EC: ZONES[4], NC: ZONES[5], FS: ZONES[6],
  KZN: ZONES[7], GP: ZONES[8], NW: ZONES[9], MP: ZONES[10], LP: ZONES[11],
};

// The old combined zone names are still stored on existing affiliates, towns,
// activities and resort rows. Each covered several of today's zones, so a
// stored old value can't be mapped to ONE new zone on its own:
//   LEGACY_ZONES  = the single zone an old value reads as when nothing better
//                   is known (records with coordinates are placed by the
//                   coordinates instead; the Re-check pass then rewrites them).
//   LEGACY_EXPAND = every current zone an old value covers (used for
//                   affiliates, who can hold several zones).
export const LEGACY_ZONES = {
  "Eastern Cape & Garden Route": Z.EC,
  "Western Cape (Cape Town & Winelands)": Z.CT,
  "Gauteng & North West": Z.GP,
};
export const LEGACY_EXPAND = {
  "Eastern Cape & Garden Route": [Z.GR, Z.EC],
  "Western Cape (Cape Town & Winelands)": [Z.CT, Z.WL, Z.WO],
  "Gauteng & North West": [Z.GP, Z.NW],
};

export function normalizeZone(z) {
  const s = String(z || "");
  return LEGACY_ZONES[s] || s;
}

// Zones outside South Africa are created on the fly from the province/region
// Google returns (e.g. "Erongo Region", "Matabeleland North Province"), so a
// stored zone is valid if it's one of the fixed SA zones OR any other short
// non-empty name.
export function isValidZone(z) {
  const s = String(z || "").trim();
  return s.length > 0 && s.length <= 120;
}

// stateProvince on a property listing is free text typed by the property
// owner (property-form.html has no dropdown for it), so this matches by
// keyword rather than requiring an exact string — "Western Cape",
// "western cape", "W Cape" style variations all still resolve correctly.
// Returns "" (no confident match) rather than guessing.
export function provinceToZone(stateProvince) {
  const s = String(stateProvince || "").toLowerCase();
  if (!s) return "";
  if (s.includes("garden route")) return Z.GR;
  if (s.includes("cape town")) return Z.CT;
  if (s.includes("winelands")) return Z.WL;
  if (s.includes("overberg") || s.includes("west coast")) return Z.WO;
  // A bare "Western Cape" can't say which of the three Western Cape zones,
  // so it is left to the town name / coordinates.
  if (s.includes("eastern cape")) return Z.EC;
  if (s.includes("northern cape")) return Z.NC;
  if (s.includes("free state")) return Z.FS;
  if (s.includes("kwazulu") || s.includes("natal")) return Z.KZN;
  if (s.includes("gauteng")) return Z.GP;
  if (s.includes("north west") || s.includes("northwest")) return Z.NW;
  if (s.includes("mpumalanga")) return Z.MP;
  if (s.includes("limpopo")) return Z.LP;
  return "";
}

// Resort/activity district & town fields are place names, not provinces
// ("Cradock", "Plettenberg Bay", "Hazyview"), so provinceToZone's substring
// match against a province name won't fire for most of them. This is a
// best-effort town/region keyword table covering the major towns across
// all 9 provinces (12 zones), including every town that appeared in the ~1,250-row
// activities dataset. Coverage is NOT exhaustive — StockNetwork's resort
// list has ~5,900 properties across many more small towns than are listed
// here, so plenty of rows will come back with zone "" (unmapped) rather
// than a guess. Unmapped just means "doesn't auto-filter into any zone
// tab" — it still shows up under "All zones".
const TOWN_ZONE_KEYWORDS = [
  [Z.CT, ["cape town", "somerset west", "strand", "durbanville", "constantia", "hout bay", "camps bay", "sea point",
    "muizenberg", "simon's town", "simons town", "gordon's bay", "gordons bay", "kommetjie", "noordhoek", "bloubergstrand",
    "table view", "melkbosstrand", "khayelitsha", "fish hoek", "kalk bay", "llandudno", "century city"]],
  [Z.WL, ["stellenbosch", "franschhoek", "paarl", "worcester", "robertson", "montagu", "ceres", "wellington",
    "tulbagh", "bonnievale", "ashton", "mcgregor", "wolseley", "rawsonville"]],
  [Z.WO, ["saldanha", "langebaan", "hermanus", "gansbaai", "bredasdorp", "arniston", "clanwilliam", "citrusdal",
    "malmesbury", "swellendam", "riebeek", "heidelberg", "witsand", "paternoster", "velddrif", "yzerfontein",
    "darling", "struisbaai", "de hoop", "onrus", "stanford", "kleinmond", "betty's bay", "bettys bay", "pringle bay",
    "napier", "vredenburg", "st helena bay", "lambert's bay", "lamberts bay", "piketberg", "moorreesburg"]],
  [Z.GR, ["garden route", "plettenberg bay", "plett", "knysna", "george", "mossel bay", "oudtshoorn", "de rust",
    "calitzdorp", "wilderness", "sedgefield", "storms river", "tsitsikamma", "nature's valley", "natures valley",
    "keurboomstrand", "stilbaai", "still bay", "riversdale", "albertinia", "herolds bay", "great brak",
    "hartenbos", "kleinbrak", "brenton", "buffalo bay", "uniondale", "ladismith", "the crags", "kurland"]],
  [Z.EC, ["port elizabeth", "gqeberha", "east london", "jeffreys bay", "jeffrey's bay",
    "graaff-reinet", "graaff reinet", "cradock", "queenstown", "komani", "port st johns", "coffee bay",
    "addo", "grahamstown", "makhanda", "kariega", "uitenhage", "barkly east",
    "hogsback", "morgan bay", "chintsa", "kenton-on-sea", "kenton on sea", "middelburg eastern cape"]],
  [Z.NC, ["kimberley", "upington", "springbok", "richmond", "sutherland", "calvinia", "de aar",
    "kuruman", "colesberg", "kathu", "augrabies", "prince albert", "beaufort west", "laingsburg"]],
  [Z.FS, ["bloemfontein", "clarens", "ficksburg", "bethlehem", "harrismith", "welkom", "parys",
    "golden gate", "fouriesburg", "ladybrand"]],
  [Z.KZN, ["durban", "pietermaritzburg", "ballito", "st lucia", "hluhluwe", "richards bay", "margate",
    "underberg", "dundee", "greytown", "newcastle", "umhlanga", "drakensberg", "zululand", "port shepstone",
    "scottburgh", "eshowe", "pongola"]],
  [Z.GP, ["johannesburg", "pretoria", "soweto", "sandton", "magaliesburg", "vanderbijlpark", "krugersdorp",
    "benoni", "centurion", "midrand", "vereeniging", "randburg", "roodepoort", "boksburg", "germiston"]],
  [Z.NW, ["hartbeespoort", "rustenburg", "sun city", "potchefstroom", "mahikeng", "mafikeng", "klerksdorp",
    "lichtenburg", "vryburg", "zeerust", "pilanesberg"]],
  [Z.MP, ["nelspruit", "mbombela", "hazyview", "sabie", "graskop", "barberton", "white river",
    "kruger", "malelane", "komatipoort", "pilgrim's rest", "pilgrims rest", "dullstroom", "lydenburg"]],
  [Z.LP, ["polokwane", "phalaborwa", "musina", "tzaneen", "louis trichardt", "makhado", "modimolle",
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

// ---------------------------------------------------------------------------
// Zone GEOGRAPHY. The keyword tables above only know a town's NAME, which
// breaks for towns that share a name across provinces (Middelburg, Elim) and
// for anything not in the table. For places inside South Africa the zone is
// now decided from the coordinate itself: which zone polygon (built from the
// district boundaries, see zone-shapes.js) contains the point.
// ---------------------------------------------------------------------------
const SHAPE_INDEX = [];
Object.keys(ZONE_SHAPES).forEach((zone) => {
  ZONE_SHAPES[zone].forEach((poly) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    poly[0].forEach((p) => {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    });
    SHAPE_INDEX.push({ zone, poly, minX, minY, maxX, maxY });
  });
});

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPoly(x, y, poly) {
  if (!inRing(x, y, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
  return true;
}

function segKm(px, py, ax, ay, bx, by, kx) {
  const X = (v) => v * kx;
  const ax_ = X(ax), bx_ = X(bx), px_ = X(px);
  const ay_ = ay * 110.57, by_ = by * 110.57, py_ = py * 110.57;
  const dx = bx_ - ax_, dy = by_ - ay_;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px_ - ax_) * dx + (py_ - ay_) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax_ + t * dx, cy = ay_ + t * dy;
  return Math.hypot(px_ - cx, py_ - cy);
}

// Which zone polygon contains this point? "" if none (sea, or outside SA).
export function zoneAtPoint(lat, lng) {
  const x = Number(lng), y = Number(lat);
  if (!isFinite(x) || !isFinite(y)) return "";
  for (const s of SHAPE_INDEX) {
    if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
    if (inPoly(x, y, s.poly)) return s.zone;
  }
  return "";
}

// Zone for a point, tolerating the coast: inside a polygon = km 0; otherwise
// the nearest zone edge and how far away it is (km). Callers decide how far
// is still "land" (a few km of slack covers the simplified coastline) and how
// far is really "in the sea".
export function locateZone(lat, lng) {
  const y = Number(lat), x = Number(lng);
  if (!isFinite(x) || !isFinite(y)) return { zone: "", km: Infinity };
  const inside = zoneAtPoint(y, x);
  if (inside) return { zone: inside, km: 0 };
  const kx = 111.32 * Math.cos((y * Math.PI) / 180);
  let best = { zone: "", km: Infinity };
  for (const s of SHAPE_INDEX) {
    // Cheap reject: bbox further away than the current best.
    const dxDeg = x < s.minX ? s.minX - x : x > s.maxX ? x - s.maxX : 0;
    const dyDeg = y < s.minY ? s.minY - y : y > s.maxY ? y - s.maxY : 0;
    if (Math.hypot(dxDeg * kx, dyDeg * 110.57) > best.km) continue;
    const ring = s.poly[0];
    for (let i = 1; i < ring.length; i++) {
      const d = segKm(x, y, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1], kx);
      if (d < best.km) best = { zone: s.zone, km: d };
    }
  }
  return best;
}

// The GeoJSON-ish shape data, for the map's coloured zone areas.
export function zoneShapes() {
  return ZONE_SHAPES;
}
