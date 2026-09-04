// Shared helper: turns a hook's caption into platform-tailored hashtag sets
// using Claude (Anthropic API). Used by both hook-api.js (self-managed
// affiliate saves) and admin-api.js (admin default-hook saves) so hashtags
// stay consistent no matter who saved the hook.
//
// Design notes:
// - Generation happens once, at save time, and the result is cached on the
//   hook record (see hook-api.js / admin-api.js). Affiliates viewing the
//   hook later just read the cached hashtags — no per-view API cost.
// - WhatsApp intentionally gets no hashtags; they aren't part of WhatsApp
//   status/caption conventions the way they are on the other platforms.
// - Any failure here (missing key, network error, bad response) returns
//   null rather than throwing, so a hook save never fails just because
//   hashtag generation had a bad day.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

const HASHTAG_TOOL = {
  name: "set_hashtags",
  description:
    "Return the best relevant hashtags for this travel promo, tailored to each social platform's own conventions.",
  input_schema: {
    type: "object",
    properties: {
      facebook: {
        type: "array",
        items: { type: "string" },
        description:
          "2-3 concise, relevant hashtags for Facebook, no leading # character.",
      },
      instagram: {
        type: "array",
        items: { type: "string" },
        description:
          "8-15 relevant hashtags for Instagram, mixing broad travel tags with specific location/property tags, no leading # character.",
      },
      linkedin: {
        type: "array",
        items: { type: "string" },
        description:
          "3-5 professional, industry-appropriate hashtags for LinkedIn, no leading # character.",
      },
    },
    required: ["facebook", "instagram", "linkedin"],
  },
};

// Strip a leading "#" and any whitespace from a model-returned tag, and
// drop anything that isn't a simple word/number token (defensive — we
// never want to inject something unexpected into an affiliate's caption).
function sanitizeTag(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^#+/, "");
  if (!cleaned) return null;
  if (!/^[A-Za-z0-9_]+$/.test(cleaned)) return null;
  return cleaned.slice(0, 40);
}

function sanitizeList(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const tag = sanitizeTag(item);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

// Returns { facebook: string[], instagram: string[], whatsapp: [], linkedin: string[] }
// or null if generation isn't possible / fails.
export async function generateHashtags(caption) {
  const text = (caption || "").trim();
  if (!text) return null;

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        tools: [HASHTAG_TOOL],
        tool_choice: { type: "tool", name: "set_hashtags" },
        messages: [
          {
            role: "user",
            content:
              "Generate relevant, high-engagement travel hashtags for this promo, tailored to each platform's own norms (Instagram: a full mixed set of broad + niche tags; Facebook: just a couple, used sparingly; LinkedIn: a small handful, professional in tone). Promo caption:\n\n" +
              text,
          },
        ],
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const toolUse = Array.isArray(data.content)
      ? data.content.find((block) => block.type === "tool_use" && block.name === "set_hashtags")
      : null;
    if (!toolUse || !toolUse.input) return null;

    const hashtags = {
      facebook: sanitizeList(toolUse.input.facebook, 3),
      instagram: sanitizeList(toolUse.input.instagram, 15),
      whatsapp: [],
      linkedin: sanitizeList(toolUse.input.linkedin, 5),
    };

    // If everything came back empty, treat it as no result.
    if (!hashtags.facebook.length && !hashtags.instagram.length && !hashtags.linkedin.length) {
      return null;
    }
    return hashtags;
  } catch (e) {
    return null;
  }
}
