// Drafts a hook caption straight from its actual flyer image via Claude's
// vision support — used by hook-share-content.js so "Get Shareable
// Content" can offer a caption that reflects exactly what's printed on the
// image (festival/property name, dates, price) instead of only whatever a
// caption was typed in by hand.
//
// Deliberately separate from hook-source.js's draftHookCaption, which drafts
// from *scraped property text*, not an image — different input, different
// prompt. The actual "call Claude with one tool" plumbing (request shape,
// tool_use extraction, fail-safe-to-null behaviour) is shared with
// hashtag-helper.js via anthropic-tool-call.js instead, since those two
// files started out as near-identical copies of exactly that.
//
// Lives in netlify/edge-functions/lib/ (not directly in edge-functions/) so
// Netlify doesn't try to auto-register it as its own routed function — same
// reason hashtag-helper.js and the other lib/ files live here too.

import { callClaudeTool } from "./anthropic-tool-call.js";

// Claude's vision input only accepts these; hook-image.js accepts any
// image/* upload, so anything else (an uncommon format like image/svg+xml
// or image/bmp) just skips the scan rather than sending a request Claude
// would reject anyway.
const SUPPORTED_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const CAPTION_TOOL = {
  name: "set_hook_caption",
  description: "Return a short, high-engagement travel promo caption ready to post on social media.",
  input_schema: {
    type: "object",
    properties: {
      caption: {
        type: "string",
        description:
          "A punchy 2-4 sentence promo caption (with an attention-grabbing opening line), written for a South African travel audience, based only on what's actually visible in the supplied flyer image (property/festival name, dates, price, key selling points) — don't invent anything the image doesn't show. No hashtags (those are generated separately), at most 1-2 emoji, no markdown.",
      },
    },
    required: ["caption"],
  },
};

// Chunked to avoid a call-stack overflow from String.fromCharCode.apply on
// a large array — hook images are capped at 5MB (hook-image.js's
// MAX_BYTES), comfortably fine in 32KB chunks.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// A stored content-type isn't always the clean "image/jpeg" a plain
// browser file upload sends — admin-api.js's saveHookPhotos stores
// whatever content-type header an external (StockNetwork) server sent
// verbatim, which can carry extra parameters (e.g. "image/jpeg;
// charset=binary"). Strip those before comparing, the same defensive
// instinct hook-image.js already applies via .startsWith("image/") at
// upload time — otherwise a perfectly valid image gets rejected here over
// a formatting technicality, not an actual unsupported format.
//
// Exported so hook-share-content.js can check this itself *before*
// marking its per-hook attempt cooldown (see there) — an unsupported
// format is known for free, with no network call, so it must not burn
// the same cooldown a real (billed) attempt does.
export function isSupportedImageMediaType(mimeType) {
  const normalized = String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return SUPPORTED_MEDIA_TYPES.includes(normalized);
}

function normalizeMediaType(mimeType) {
  return String(mimeType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

// Returns a caption string, or null if generation isn't possible / fails.
export async function draftCaptionFromImage(imageBytes, mimeType) {
  if (!imageBytes || !imageBytes.byteLength) return null;

  const normalizedMimeType = normalizeMediaType(mimeType);
  if (!SUPPORTED_MEDIA_TYPES.includes(normalizedMimeType)) return null;

  const base64 = arrayBufferToBase64(imageBytes);
  const input = await callClaudeTool(
    [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: normalizedMimeType, data: base64 } },
          {
            type: "text",
            text: "Write a ready-to-post promo caption for this travel flyer, based only on what's visible in the image.",
          },
        ],
      },
    ],
    CAPTION_TOOL,
    300
  );

  const caption = input && typeof input.caption === "string" ? input.caption.trim() : "";
  return caption || null;
}
