// Draws a finished flyer as a plain SVG string — no Canva API call, no
// external rendering service. Uses the exact geometry/colors/fonts
// captured once from Jean's real master design (lib/hook-templates.js) and
// a hook's resolved field values (lib/hook-flyer.js) plus its own saved
// photos (already-fetched image bytes, passed in as data: URIs by the
// caller — see admin-api.js/hook-api.js's renderFlyer action).
//
// Text is laid out with a simple word-wrap + shrink-to-fit pass, since
// real scraped/typed text runs longer or shorter than the placeholder text
// the master design happened to have in each box. A box with no value for
// its field is just left empty — never filled with placeholder/sample
// text — matching the rest of this app's "nothing invented" rule.
//
// The two brand fonts (Montserrat for headings, Noto Sans for body copy)
// are referenced by family name only, exactly as already loaded via
// Google Fonts in both admin.html and hub.html — this module assumes it's
// being inserted as *inline* SVG into one of those pages (not rendered via
// <img src="data:...">), so the browser resolves those font-family names
// against the fonts the page already loaded. See admin.html/hub.html's
// "Generate flyer" UI for the PNG/SVG export path.

function escapeXml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

// Rough average glyph width as a fraction of font size — tuned per brand
// font/weight, close enough for wrapping decisions (not pixel-exact
// measurement, which would need an actual font metrics table).
function estCharWidth(fontSize, font, bold) {
  if (font === "heading") return fontSize * (bold ? 0.6 : 0.55);
  return fontSize * (bold ? 0.55 : 0.5);
}

function wrapText(text, maxWidth, fontSize, font, bold) {
  const charW = estCharWidth(fontSize, font, bold);
  const maxChars = Math.max(1, Math.floor(maxWidth / charW));
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (candidate.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Wraps `text` to fit `geometry`, shrinking font size (down to 55% of the
// template's captured size) before finally truncating with an ellipsis as
// a last resort, so a longer real description still fits the box instead
// of silently spilling out of it.
function fitTextBlock(text, geometry, style) {
  const floor = style.fontSize * 0.55;
  let fontSize = style.fontSize;
  let lines = [];
  for (;;) {
    lines = wrapText(text, geometry.width, fontSize, style.font, style.fontWeight === "bold");
    const blockHeight = lines.length * fontSize * 1.4;
    if (blockHeight <= geometry.height || fontSize <= floor) break;
    fontSize -= 1;
  }
  const maxLines = Math.max(1, Math.floor(geometry.height / (fontSize * 1.4)));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1] || "";
    lines[maxLines - 1] = last.replace(/\s+\S*$/, "").trim() + "…";
  }
  return { lines: lines, fontSize: fontSize };
}

function renderTextField(field, rawValue) {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) return "";
  const g = field.geometry;
  const s = field.style;
  const fontFamily = s.font === "heading" ? "Montserrat, sans-serif" : "'Noto Sans', sans-serif";
  const weight = s.fontWeight === "bold" ? (s.font === "heading" ? 800 : 700) : s.font === "heading" ? 600 : 400;
  const anchor = s.textAlign === "center" ? "middle" : "start";
  const xBase = s.textAlign === "center" ? g.left + g.width / 2 : g.left;
  const decorationAttr = s.decoration === "underline" ? ' text-decoration="underline"' : "";

  let lines;
  let fontSize;
  if (value.indexOf("\n") !== -1) {
    // Explicit line breaks (e.g. the two-line price badge) are respected
    // as-is — only shrunk if they don't fit the box, never re-wrapped.
    lines = value.split("\n").map((l) => l.trim()).filter(Boolean);
    fontSize = s.fontSize;
    while (lines.length * fontSize * 1.4 > g.height && fontSize > s.fontSize * 0.5) fontSize -= 1;
  } else {
    const fit = fitTextBlock(value, g, s);
    lines = fit.lines;
    fontSize = fit.fontSize;
  }

  const lineHeight = fontSize * 1.4;
  const blockHeight = lines.length * lineHeight;
  const startY = g.top + Math.max(0, (g.height - blockHeight) / 2) + fontSize * 0.85;
  const tspans = lines
    .map((line, i) => '<tspan x="' + xBase + '" y="' + (startY + i * lineHeight) + '">' + escapeXml(line) + "</tspan>")
    .join("");
  return (
    '<text font-family="' + fontFamily + '" font-size="' + fontSize + '" font-weight="' + weight +
    '" fill="' + s.color + '" text-anchor="' + anchor + '"' + decorationAttr + ">" + tspans + "</text>"
  );
}

function circleChrome(spec) {
  if (!spec) return "";
  const g = spec.geometry;
  const cx = g.left + g.width / 2;
  const cy = g.top + g.height / 2;
  return '<circle cx="' + cx + '" cy="' + cy + '" r="' + g.width / 2 + '" fill="' + spec.color + '"/>';
}

function roundRectChrome(spec) {
  if (!spec) return "";
  const g = spec.geometry;
  return (
    '<rect x="' + g.left + '" y="' + g.top + '" width="' + g.width + '" height="' + g.height +
    '" rx="' + (spec.rx || 0) + '" fill="' + spec.color + '"/>'
  );
}

function pathShapeChrome(spec) {
  if (!spec || !spec.pathShape) return "";
  const g = spec.geometry;
  const vb = spec.pathShape.viewBox;
  const sx = g.width / vb.width;
  const sy = g.height / vb.height;
  return (
    '<g transform="translate(' + g.left + "," + g.top + ") scale(" + sx + "," + sy + ')">' +
    '<path d="' + spec.pathShape.d + '" fill="' + spec.color + '"/></g>'
  );
}

function checkIconSvg(spec, color) {
  const g = spec.geometry;
  const cx = g.left + g.width / 2;
  const cy = g.top + g.height / 2;
  const r = g.width / 2;
  const sw = Math.max(2, r * 0.2);
  const path = "M" + (cx - r * 0.42) + " " + cy + " l" + r * 0.32 + " " + r * 0.32 + " l" + r * 0.5 + " -" + r * 0.58;
  return (
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '"/>' +
    '<path d="' + path + '" stroke="#ffffff" stroke-width="' + sw + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  );
}

function phoneIconSvg(spec) {
  const g = spec.geometry;
  const cx = g.left + g.width / 2;
  const cy = g.top + g.height / 2;
  const fs = g.width * 0.62;
  return (
    '<text x="' + cx + '" y="' + cy + '" font-size="' + fs + '" text-anchor="middle" dominant-baseline="central" fill="' +
    spec.color + '">☎</text>'
  );
}

function logoSvg(spec) {
  const g = spec.geometry;
  const fb = spec.textFallback;
  const fs = g.height * 0.4;
  return (
    '<text font-family="Montserrat, sans-serif" font-weight="800" font-size="' + fs + '" fill="' + fb.color + '">' +
    '<tspan x="' + g.left + '" y="' + (g.top + fs) + '">' + escapeXml(fb.line1) + "</tspan>" +
    '<tspan x="' + g.left + '" y="' + (g.top + fs * 2.05) + '">' + escapeXml(fb.line2) + "</tspan></text>"
  );
}

function imageFieldSvg(imgField, dataUri, uid) {
  // A slot with no saved photo yet is left visibly empty (a faint outline)
  // rather than silently filled with a stand-in image — matches the
  // "nothing invented" rule for photos too.
  const g = imgField.geometry;
  if (!dataUri) {
    const shape =
      imgField.shape === "circle"
        ? '<circle cx="' + (g.left + g.width / 2) + '" cy="' + (g.top + g.height / 2) + '" r="' + g.width / 2 + '"/>'
        : '<rect x="' + g.left + '" y="' + g.top + '" width="' + g.width + '" height="' + g.height + '"/>';
    return '<g fill="#f2f2f2" stroke="#cccccc" stroke-width="2" stroke-dasharray="8,6">' + shape + "</g>";
  }
  const clipId = "flyerclip-" + imgField.key + "-" + uid;
  const clipShape =
    imgField.shape === "circle"
      ? '<circle cx="' + g.width / 2 + '" cy="' + g.height / 2 + '" r="' + g.width / 2 + '"/>'
      : '<rect x="0" y="0" width="' + g.width + '" height="' + g.height + '"/>';
  return (
    '<defs><clipPath id="' + clipId + '">' + clipShape + "</clipPath></defs>" +
    '<g transform="translate(' + g.left + "," + g.top + ')" clip-path="url(#' + clipId + ')">' +
    '<image href="' + dataUri + '" x="0" y="0" width="' + g.width + '" height="' + g.height +
    '" preserveAspectRatio="xMidYMid slice"/></g>'
  );
}

// template: a HOOK_TEMPLATES entry (see lib/hook-templates.js).
// values: { [fieldKey]: string } from resolveFlyerFields.
// images: { heroImage?, featureImage?, lifestyleImage? } — each a data:
//   URI string, or omitted/null/"" to leave that photo box empty.
// Returns a self-contained <svg>...</svg> string sized to the template's
// canvasSize, safe to insert inline into a page (innerHTML) or save as a
// standalone .svg file.
export function renderFlyerSVG(template, values, images) {
  const W = template.canvasSize.width;
  const H = template.canvasSize.height;
  const chrome = template.chrome;
  const imgs = images && typeof images === "object" ? images : {};
  const uid = Math.random().toString(36).slice(2, 8);
  const findImg = (key) => template.images.find((i) => i.key === key);

  // width/height attributes give the SVG its real intrinsic resolution
  // (matters when it's saved as a standalone .svg file and opened
  // elsewhere); the inline style width:100%/height:auto is what actually
  // governs on-page rendering — CSS sizing overrides the plain attributes
  // — so dropping this flyer into a narrower preview box (see admin.html/
  // hub.html's "Generate flyer" panel) scales it down instead of
  // overflowing the box at full 1080x1350 size.
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H +
    '" style="width:100%;height:auto;display:block;">';
  svg += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';

  for (const c of chrome.backdropCircles) svg += circleChrome(c);
  svg += imageFieldSvg(findImg("heroImage"), imgs.heroImage, uid);
  svg += imageFieldSvg(findImg("featureImage"), imgs.featureImage, uid);
  svg += circleChrome(chrome.lifestyleBacking);
  svg += imageFieldSvg(findImg("lifestyleImage"), imgs.lifestyleImage, uid);
  for (const icon of chrome.amenityIcons) svg += checkIconSvg(icon, chrome.amenityIconColor);
  svg += roundRectChrome(chrome.contactBlock);
  svg += phoneIconSvg(chrome.contactPhoneIcon);
  svg += logoSvg(chrome.logo);
  svg += roundRectChrome(chrome.promoTagBanner);
  svg += pathShapeChrome(chrome.priceBadge);

  for (const field of template.fields) {
    svg += renderTextField(field, values ? values[field.key] : "");
  }

  svg += "</svg>";
  return svg;
}
