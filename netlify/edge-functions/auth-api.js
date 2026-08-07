import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

const DEFAULT_PASSWORD = "0000";

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default async (request, context) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  const aff = typeof body.aff === "string" ? body.aff.trim() : "";
  const action = body.action;

  if (!aff) {
    return new Response(JSON.stringify({ error: "missing aff" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
    });
  }

  const store = getStore({ name: "affiliate-auth", consistency: "strong" });

  try {
    const record = await store.get(aff, { type: "json" });
    const storedHash = record && record.passwordHash ? record.passwordHash : await sha256Hex(DEFAULT_PASSWORD);

    if (action === "login") {
      const password = typeof body.password === "string" ? body.password : "";
      const hash = await sha256Hex(password);
      if (hash === storedHash) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json", ...cors },
        });
      }
      return new Response(JSON.stringify({ ok: false, error: "Incorrect affiliate number or password" }), {
        status: 401,
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (action === "change") {
      const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

      if (!newPassword || newPassword.length < 4) {
        return new Response(JSON.stringify({ ok: false, error: "New password must be at least 4 characters" }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      const oldHash = await sha256Hex(oldPassword);
      if (oldHash !== storedHash) {
        return new Response(JSON.stringify({ ok: false, error: "Current password is incorrect" }), {
          status: 401,
          headers: { "content-type": "application/json", ...cors },
        });
      }

      const newHash = await sha256Hex(newPassword);
      await store.setJSON(aff, { passwordHash: newHash, updatedAt: new Date().toISOString() });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (action === "reset") {
      // No email system exists in this app, so "forgot password" simply
      // reverts the affiliate's account back to the default password (0000)
      // — the same one every new affiliate starts with. Anyone resetting
      // needs to already know the affiliate's ID, which matches this app's
      // existing security level throughout.
      await store.delete(aff);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { "content-type": "application/json", ...cors },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors },
    });
  }
};

export const config = { path: "/api/auth" };
