// Tiny shared base64 <-> data: URI helpers, Deno-safe (no Buffer).
//
// bytesToDataUri is used by lib/places-images.js to hand fetched photo
// bytes to the browser without ever exposing the Google Places API key a
// direct photo URL would carry (see there for why that matters) — the
// browser gets pixels, not a URL it could re-fetch or leak.
//
// dataUriToBytes is the reverse, used by admin-api.js/hook-api.js's
// savePlacePhoto action: the browser already has the bytes (as a data URI,
// from findPlaceImages), so the admin's "use this photo" click sends them
// straight back rather than the server re-fetching from Google a second
// time.

// Chunks the byte array so a large photo doesn't blow call-stack limits on
// String.fromCharCode.apply — same approach as lib/hook-flyer-images.js's
// local copy of this (kept separate rather than shared, since that file's
// comment explicitly scopes it to "the flyer feature").
export function bytesToDataUri(buf, contentType) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return "data:" + (contentType || "application/octet-stream") + ";base64," + btoa(binary);
}

// Returns { contentType, buf } (buf: ArrayBuffer) or null if `s` isn't a
// well-formed "data:image/...;base64,...." string.
export function dataUriToBytes(s) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
    typeof s === "string" ? s : ""
  );
  if (!m) return null;
  try {
    const binary = atob(m[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { contentType: m[1], buf: bytes.buffer };
  } catch (e) {
    return null;
  }
}
