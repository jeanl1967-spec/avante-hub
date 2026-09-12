// Drafts a hook caption straight from its actual flyer image via Claude's
// vision support — used by hook-share-content.js so "Get Shareable
// Content" can offer a caption that reflects exactly what's printed on the
// image (festival/property name, dates, price) instead of only whatever a
// caption was typed in by hand.
//
// Deliberately separate from hook-source.js's draftHookCaption, which drafts
// from *scraped property text*, not an image — different input, different
// prompt, no shared logic worth factoring out beyond the same call
// pattern and failure behaviour (missing key, network error, or a bad
// response all return null rather than throwing, so a scan request
// degrades gracefully instead of failing the whole "Get Shareable Content"
// open).
//
// Lives in netlify/edge-functions/lib/ (not directly in edge-functions/) so
// Netlify doesn't try to auto-register it as its own routed function — same
// reason hashtag-helper.js and the other lib/ files live here too.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

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

// Returns a caption string, or null if generation isn't possible / fails.
export async function draftCaptionFromImage(imageBytes, mimeType) {
  if (!imageBytes || !imageBytes.byteLength) return null;
  if (!SUPPORTED_MEDIA_TYPES.includes(mimeType)) return null;

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  try {
    const base64 = arrayBufferToBase64(imageBytes);
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        tools: [CAPTION_TOOL],
        tool_choice: { type: "tool", name: "set_hook_caption" },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
              {
                type: "text",
                text: "Write a ready-to-post promo caption for this travel flyer, based only on what's visible in the image.",
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const toolUse = Array.isArray(data.content)
      ? data.content.find((block) => block.type === "tool_use" && block.name === "set_hook_caption")
      : null;
    const caption =
      toolUse && toolUse.input && typeof toolUse.input.caption === "string" ? toolUse.input.caption.trim() : "";
    return caption || null;
  } catch (e) {
    return null;
  }
}
