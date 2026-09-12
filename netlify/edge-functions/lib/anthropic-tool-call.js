// Shared plumbing for a single-tool Claude tool-call request — the exact
// boilerplate hashtag-helper.js's generateHashtags and
// vision-caption-helper.js's draftCaptionFromImage each needed on top of
// their own, genuinely different, prompts/tools/inputs (one drafts a
// hashtag set from text, the other a caption from an image). Extracted
// after code review flagged the two files as near-duplicates of this one
// piece — the request shape, the tool_use extraction, and the
// fail-safe-to-null behaviour on a missing key / network error / bad
// response were identical in both and worth keeping that way on purpose,
// not by two files happening to agree for now.
//
// Lives in netlify/edge-functions/lib/ (not directly in edge-functions/) so
// Netlify doesn't try to auto-register it as its own routed function — same
// reason every other file in here does too.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

// tool: an Anthropic tool definition ({name, description, input_schema}).
// Returns that tool's `input` object, or null if generation isn't
// possible / fails for any reason (missing ANTHROPIC_API_KEY, network
// error, non-2xx response, or a response that didn't use the tool).
export async function callClaudeTool(messages, tool, maxTokens) {
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
        max_tokens: maxTokens,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: messages,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const toolUse = Array.isArray(data.content)
      ? data.content.find((block) => block.type === "tool_use" && block.name === tool.name)
      : null;
    return toolUse ? toolUse.input : null;
  } catch (e) {
    return null;
  }
}
