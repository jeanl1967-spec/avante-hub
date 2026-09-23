// Drafts an Event hook's content from a source Jean already has, instead of
// typing everything in by hand — see admin-api.js's draftEventFromUrl /
// draftEventFromImage actions, which are the only callers. Two entry
// points, one shared "never invent, leave blank if not stated" extraction
// tool:
//   - draftEventFromUrl(url): fetches the event's own website and asks
//     Claude to pull out whichever of the standard Event hook fields the
//     page actually states.
//   - draftEventFromImage(bytes, mimeType): same extraction, but from a
//     photo (e.g. an existing printed flyer/poster for the event) via
//     Claude's vision support, instead of page text.
// Both return { ok: true, fields } or { ok: false, reason, message } — same
// shape/spirit as lib/places-images.js's searchPlacePhotos. `fields` always
// has every EVENT_FIELD_KEYS key present, "" for anything not actually
// stated in the source — exactly the "nothing invented, blank if unknown"
// rule every other content source in this app follows. The caller shows
// this as a draft for a human to review and edit (same as
// generateHookDraft's property/area drafts) — nothing here saves anything.

import { callClaudeTool } from "./anthropic-tool-call.js";

// Same reasoning as lib/places-images.js's FETCH_TIMEOUT_MS: this can run
// inside a Netlify Edge Function with its own execution limit, and a hung
// external site must not be allowed to stall past that.
const FETCH_TIMEOUT_MS = 8000;
// A normal event page's real copy is a few hundred words — this is a
// generous cap on the raw HTML read (before stripping), just to bound how
// much a single pasted URL can make this function download/hold in memory.
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
// Cap on the plain-text handed to Claude after stripping — keeps the
// extraction prompt small/cheap; real event-page copy is nowhere near this.
const MAX_TEXT_CHARS = 8000;

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export const EVENT_FIELD_KEYS = [
  "eventNameLine1",
  "eventNameLine2",
  "eventSubtitle",
  "eventHighlight1",
  "eventHighlight2",
  "eventHighlight3",
  "eventHighlight4",
  "eventDate",
  "eventLocationName",
  "eventLocationDetail",
  "eventTheme",
];

// Deliberately excludes eventSectionHeading (see hook-templates.js) — that's
// a fixed label ("Highlights") Jean types once, not something to extract
// from a source page/photo.
const EVENT_DRAFT_TOOL = {
  name: "set_event_draft",
  description:
    "Return whichever of these event-flyer fields are actually stated in the supplied source. Leave a field as an empty string if it isn't stated there — never guess, invent, or embellish. This becomes real ad copy for a real event; accuracy matters more than completeness.",
  input_schema: {
    type: "object",
    properties: {
      eventNameLine1: {
        type: "string",
        description: "The event's name, or its location if the name itself is really just the place (e.g. \"Hermanus\"). Short — a few words.",
      },
      eventNameLine2: {
        type: "string",
        description: "A second line for the event name — often the event's actual title/tagline when line 1 is just a place (e.g. \"Whale Festival\").",
      },
      eventSubtitle: {
        type: "string",
        description: "A one-line description/hook for the event, only if the source states one.",
      },
      eventHighlight1: { type: "string", description: "A short highlight, activity, or feature of the event." },
      eventHighlight2: { type: "string", description: "A second highlight, distinct from the first." },
      eventHighlight3: { type: "string", description: "A third highlight, distinct from the first two." },
      eventHighlight4: { type: "string", description: "A fourth highlight, distinct from the others." },
      eventDate: { type: "string", description: "The event's date(s), exactly as stated (e.g. \"2 - 4 October 2026\")." },
      eventLocationName: { type: "string", description: "The town/area the event is in (e.g. \"Hermanus\")." },
      eventLocationDetail: {
        type: "string",
        description: "A more specific venue, address, or region, only if stated (e.g. \"Old Harbour, Marine Drive\").",
      },
      eventTheme: {
        type: "string",
        description: "A short tag for what kind of event this is (e.g. \"whale watching\", \"cycling\", \"music\"), only if that's clear from the source.",
      },
    },
    required: [],
  },
};

function fieldsFromToolInput(input) {
  const out = {};
  for (const key of EVENT_FIELD_KEYS) {
    out[key] = input && typeof input[key] === "string" ? input[key].trim().slice(0, 400) : "";
  }
  return out;
}

// -----------------------------------------------------------------------
// From a URL
// -----------------------------------------------------------------------

// Blocks the obvious private/loopback/link-local cases a pasted URL could
// point at (by accident, or otherwise) — not exhaustive DNS-rebinding
// protection (this app has no outbound-request sandboxing to lean on), just
// a cheap, worthwhile guard against the plainly-wrong ones, on the one
// action in this codebase that fetches a URL someone else supplies rather
// than one this app already knows (StockNetwork, Google).
function isSafeHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || host === "0.0.0.0" || host.endsWith(".local")) return false;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

// Strips an HTML document down to plain, readable text. Not a real HTML
// parser (Deno's edge runtime has no DOM to lean on here) — just enough
// cleanup that script/style/markup noise doesn't drown out a page's actual
// words before handing them to Claude.
function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// Returns { ok: true, fields } or { ok: false, reason, message }. `reason`
// is one of "empty_url" / "bad_url" / "timeout" / "network" / "http_<code>"
// / "not_html" / "no_text" / "draft_unavailable" — mirroring
// places-images.js's reason/message split (a short machine tag plus, where
// there's something specific to say, a ready-to-show sentence).
export async function draftEventFromUrl(rawUrl) {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!url) return { ok: false, reason: "empty_url", message: "" };
  if (!isSafeHttpUrl(url)) {
    return { ok: false, reason: "bad_url", message: "That doesn't look like a public web address (needs to start with http:// or https://)." };
  }

  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; AvanteHubBot/1.0)" } });
  } catch (e) {
    const timedOut = e && e.name === "AbortError";
    return { ok: false, reason: timedOut ? "timeout" : "network", message: String((e && e.message) || e) };
  }
  if (!res.ok) {
    return { ok: false, reason: "http_" + res.status, message: "That page returned an error (HTTP " + res.status + ")." };
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return { ok: false, reason: "not_html", message: "That link isn't a normal web page (got \"" + (contentType || "an unknown file type") + "\")." };
  }

  let raw;
  try {
    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength > MAX_PAGE_BYTES ? buf.slice(0, MAX_PAGE_BYTES) : buf;
    raw = new TextDecoder().decode(bytes);
  } catch (e) {
    return { ok: false, reason: "bad_response", message: "Could not read that page's content." };
  }

  const text = htmlToText(raw).slice(0, MAX_TEXT_CHARS);
  if (!text || text.length < 20) {
    return { ok: false, reason: "no_text", message: "That page didn't have any readable text to draft from." };
  }

  const input = await callClaudeTool(
    [
      {
        role: "user",
        content: "Here is the text of a web page for a real event. Pull out whichever of the event-flyer fields it actually states.\n\n---\n" + text + "\n---",
      },
    ],
    EVENT_DRAFT_TOOL,
    600
  );
  if (!input) {
    return { ok: false, reason: "draft_unavailable", message: "Could not draft from that page right now — please try again, or fill the fields in by hand." };
  }
  return { ok: true, fields: fieldsFromToolInput(input) };
}

// -----------------------------------------------------------------------
// From an uploaded photo (e.g. an existing flyer/poster for the event)
// -----------------------------------------------------------------------

// A stored/uploaded content-type isn't always a clean "image/png" (can
// carry extra parameters) — same defensive strip vision-caption-helper.js's
// own normalizeMediaType applies, kept as a separate local copy here since
// that file scopes its own version to the flyer-caption feature specifically.
function normalizeMediaType(mimeType) {
  return String(mimeType || "").split(";")[0].trim().toLowerCase();
}

// Chunked to avoid a call-stack overflow from String.fromCharCode.apply on
// a large array — same approach as every other base64 encoder in this app
// (see lib/data-uri.js's header comment on why each stays a local copy).
function bytesToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Returns { ok: true, fields } or { ok: false, reason, message }.
export async function draftEventFromImage(imageBytes, mimeType) {
  if (!imageBytes || !imageBytes.byteLength) return { ok: false, reason: "no_image", message: "" };
  const normalizedMimeType = normalizeMediaType(mimeType);
  if (!SUPPORTED_IMAGE_TYPES.includes(normalizedMimeType)) {
    return { ok: false, reason: "unsupported_type", message: "That image format isn't supported for reading — try a JPEG or PNG instead." };
  }

  const base64 = bytesToBase64(imageBytes);
  const input = await callClaudeTool(
    [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: normalizedMimeType, data: base64 } },
          {
            type: "text",
            text: "Here is a photo of an existing flyer, poster, or announcement for a real event. Pull out whichever of the event-flyer fields it actually shows — read the text on it, don't guess at anything it doesn't show.",
          },
        ],
      },
    ],
    EVENT_DRAFT_TOOL,
    600
  );
  if (!input) {
    return { ok: false, reason: "draft_unavailable", message: "Could not draft from that photo right now — please try again, or fill the fields in by hand." };
  }
  return { ok: true, fields: fieldsFromToolInput(input) };
}
