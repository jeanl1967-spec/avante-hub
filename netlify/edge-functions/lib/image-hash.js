// Tiny shared helper: a stable content hash for an uploaded hook image,
// used to know whether a hook's image has actually changed since the last
// AI caption scan (see hook-image.js, which stores this on upload, and
// hook-share-content.js, which compares against it before re-scanning).
//
// Lives in netlify/edge-functions/lib/ (not directly in edge-functions/) so
// Netlify doesn't try to auto-register it as its own routed function — same
// reason hashtag-helper.js and the other lib/ files live here too.

export async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
