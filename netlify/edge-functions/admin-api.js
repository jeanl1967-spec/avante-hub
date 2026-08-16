import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

// No hardcoded default password on purpose — this repo is public, so a
// baked-in default would be visible to anyone who reads the source. Instead
// the very first login is a one-time "setup" that creates the admin account.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Revenue channels — these keys must stay in sync with the CHANNELS list in
// admin.html. They map onto the actual booking tabs an affiliate sees in
// their Hub header (hub.html), since each one is tracked/paid separately.
const CHANNEL_KEYS = ["accommodation", "flights", "activities", "car", "package"];

// Each channel's share can be a percentage of revenue, or a flat Rand
// amount (e.g. R200 per booking logged), regardless of the revenue figure.
function sanitizeChannelShare(raw, fallbackPct) {
  if (raw && typeof raw === "object") {
    const type = raw.type === "amount" ? "amount" : "percent";
    let value = Number(raw.value);
    if (!isFinite(value) || value < 0) value = 0;
    if (type === "percent" && value > 100) value = 100;
    return { type: type, value: value };
  }
  // Legacy: a plain number meant a flat percentage.
  let v = Number(raw);
  if (!isFinite(v)) v = isFinite(fallbackPct) ? Number(fallbackPct) : 0;
  v = Math.max(0, Math.min(100, v));
  return { type: "percent", value: v };
}

function sanitizeRevenueShare(input, fallbackPct) {
  const out = {};
  for (const key of CHANNEL_KEYS) {
    const raw = input && typeof input === "object" ? input[key] : undefined;
    out[key] = sanitizeChannelShare(raw, fallbackPct);
  }
  return out;
}

// Legacy records saved before per-channel shares existed only have a flat
// revenueSharePct (or an older revenueShare object of plain numbers). This
// upgrades them to the current { type, value } shape on the fly (read-only,
// not persisted) so the UI never sees a blank/broken affiliate.
function withRevenueShare(record) {
  if (!record) return record;
  record.revenueShare = sanitizeRevenueShare(record.revenueShare, record.revenueSharePct);
  return record;
}

// Revenue logged per channel, kept separately from totalRevenue so the
// Leaderboard can rank affiliates within a single channel, not just overall.
function withChannelRevenue(record) {
  if (!record) return record;
  const out = {};
  for (const key of CHANNEL_KEYS) {
    const v = record.channelRevenue && Number(record.channelRevenue[key]);
    out[key] = isFinite(v) && v > 0 ? v : 0;
  }
  record.channelRevenue = out;
  return record;
}

function sanitizeBankDetails(input) {
  const src = input && typeof input === "object" ? input : {};
  const clean = (v) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
  return {
    bankName: clean(src.bankName),
    accountHolder: clean(src.accountHolder),
    accountNumber: clean(src.accountNumber),
    branchCode: clean(src.branchCode),
    accountType: clean(src.accountType),
  };
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json", ...cors },
  });
}

export default async (request, context) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const authStore = getStore({ name: "admin-auth", consistency: "strong" });
  const sessionStore = getStore({ name: "admin-sessions", consistency: "strong" });
  const directoryStore = getStore({ name: "affiliates-directory", consistency: "strong" });
  const payoutStore = getStore({ name: "affiliate-payouts", consistency: "strong" });
  const hookStore = getStore({ name: "promo-hooks", consistency: "strong" });
  const DEFAULT_HOOK_COUNT = 6;

  async function verifyToken(token) {
    if (!token) return false;
    const session = await sessionStore.get(token, { type: "json" });
    if (!session) return false;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      context.waitUntil(sessionStore.delete(token));
      return false;
    }
    return true;
  }

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const resource = url.searchParams.get("resource") || "";

      if (resource === "setupStatus") {
        const record = await authStore.get("admin", { type: "json" });
        return json({ ok: true, needsSetup: !record }, 200, cors);
      }

      const token = url.searchParams.get("token") || "";
      const authed = await verifyToken(token);
      if (!authed) return json({ ok: false, error: "Not authenticated." }, 401, cors);

      if (resource === "affiliates") {
        const { blobs } = await directoryStore.list();
        const list = [];
        for (const b of blobs) {
          const rec = await directoryStore.get(b.key, { type: "json" });
          if (rec) list.push(withChannelRevenue(withRevenueShare(rec)));
        }
        list.sort(function (a, b) {
          return (a.name || a.affId).localeCompare(b.name || b.affId);
        });
        return json({ ok: true, affiliates: list, channels: CHANNEL_KEYS }, 200, cors);
      }

      if (resource === "payouts") {
        const affId = (url.searchParams.get("affId") || "").trim();
        if (!affId) return json({ ok: false, error: "missing affId" }, 400, cors);
        const entries = (await payoutStore.get(affId, { type: "json" })) || [];
        return json({ ok: true, entries: entries }, 200, cors);
      }

      if (resource === "defaultHooks") {
        const hooks = [];
        for (let n = 1; n <= DEFAULT_HOOK_COUNT; n++) {
          const rec = await hookStore.get("__admin__:" + n, { type: "json" });
          hooks.push({
            hook: n,
            booking: (rec && rec.booking) || "",
            landing: (rec && rec.landing) || "",
            updatedAt: (rec && rec.updatedAt) || null,
          });
        }
        return json({ ok: true, hooks: hooks }, 200, cors);
      }

      return json({ ok: false, error: "unknown resource" }, 400, cors);
    }

    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: "invalid JSON" }, 400, cors);
    }

    const action = body.action;

    if (action === "setup") {
      const existing = await authStore.get("admin", { type: "json" });
      if (existing) {
        return json({ ok: false, error: "An admin account already exists — please log in instead." }, 409, cors);
      }
      const password = typeof body.password === "string" ? body.password : "";
      if (!password || password.length < 6) {
        return json({ ok: false, error: "Password must be at least 6 characters." }, 400, cors);
      }
      const hash = await sha256Hex(password);
      await authStore.setJSON("admin", { passwordHash: hash, createdAt: new Date().toISOString() });

      const token = randomToken();
      await sessionStore.setJSON(token, {
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      });
      return json({ ok: true, token: token }, 200, cors);
    }

    if (action === "login") {
      const record = await authStore.get("admin", { type: "json" });
      if (!record) {
        return json({ ok: false, error: "No admin account exists yet — please set one up first." }, 404, cors);
      }
      const password = typeof body.password === "string" ? body.password : "";
      const hash = await sha256Hex(password);
      if (hash !== record.passwordHash) {
        return json({ ok: false, error: "Incorrect password." }, 401, cors);
      }
      const token = randomToken();
      await sessionStore.setJSON(token, {
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      });
      return json({ ok: true, token: token }, 200, cors);
    }

    if (action === "forgotPassword") {
      // No email system exists in this app, so recovery relies on a
      // recovery phrase the admin sets themselves (via Change Password)
      // ahead of time. If none was ever set, there's no automated way
      // back in — only someone with access to the Netlify dashboard can
      // clear the "admin" key in the admin-auth Blobs store, which brings
      // back the one-time account setup screen.
      const record = await authStore.get("admin", { type: "json" });
      if (!record) {
        return json({ ok: false, error: "No admin account exists yet." }, 404, cors);
      }
      if (!record.recoveryPhraseHash) {
        return json(
          {
            ok: false,
            error:
              "No recovery phrase has been set for this account, so automatic recovery isn't available. Only someone with access to the Netlify dashboard can reset it manually (Blobs → admin-auth → delete the \"admin\" key), which brings back the account setup screen.",
          },
          400,
          cors
        );
      }
      const recoveryPhrase = typeof body.recoveryPhrase === "string" ? body.recoveryPhrase.trim().toLowerCase() : "";
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
      if (!recoveryPhrase) return json({ ok: false, error: "Enter your recovery phrase." }, 400, cors);

      const phraseHash = await sha256Hex(recoveryPhrase);
      if (phraseHash !== record.recoveryPhraseHash) {
        return json({ ok: false, error: "That recovery phrase doesn't match." }, 401, cors);
      }
      if (!newPassword || newPassword.length < 6) {
        return json({ ok: false, error: "New password must be at least 6 characters." }, 400, cors);
      }

      const newHash = await sha256Hex(newPassword);
      await authStore.setJSON("admin", {
        passwordHash: newHash,
        recoveryPhraseHash: record.recoveryPhraseHash,
        updatedAt: new Date().toISOString(),
      });

      const token = randomToken();
      await sessionStore.setJSON(token, {
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      });
      return json({ ok: true, token: token }, 200, cors);
    }

    // Every other action requires a valid session token.
    const authed = await verifyToken(body.token);
    if (!authed) return json({ ok: false, error: "Not authenticated." }, 401, cors);

    if (action === "logout") {
      await sessionStore.delete(body.token);
      return json({ ok: true }, 200, cors);
    }

    if (action === "changePassword") {
      const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : "";
      const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
      const recoveryPhrase = typeof body.recoveryPhrase === "string" ? body.recoveryPhrase.trim() : "";
      if (!newPassword || newPassword.length < 6) {
        return json({ ok: false, error: "New password must be at least 6 characters." }, 400, cors);
      }
      const record = await authStore.get("admin", { type: "json" });
      const storedHash = record && record.passwordHash;
      const oldHash = await sha256Hex(oldPassword);
      if (!storedHash || oldHash !== storedHash) {
        return json({ ok: false, error: "Current password is incorrect." }, 401, cors);
      }
      const newHash = await sha256Hex(newPassword);
      const updated = { passwordHash: newHash, updatedAt: new Date().toISOString() };
      if (recoveryPhrase) {
        updated.recoveryPhraseHash = await sha256Hex(recoveryPhrase.toLowerCase());
      } else if (record && record.recoveryPhraseHash) {
        updated.recoveryPhraseHash = record.recoveryPhraseHash;
      }
      await authStore.setJSON("admin", updated);
      return json({ ok: true }, 200, cors);
    }

    if (action === "upsertAffiliate") {
      const affId = typeof body.affId === "string" ? body.affId.trim() : "";
      if (!affId) return json({ ok: false, error: "Please enter an affiliate ID." }, 400, cors);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const siteNr = typeof body.siteNr === "string" ? body.siteNr.trim() : "";
      const revenueShare = sanitizeRevenueShare(body.revenueShare, 0);
      const bank = sanitizeBankDetails(body.bank);
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      const status = body.status === "inactive" ? "inactive" : "active";

      const existing = await directoryStore.get(affId, { type: "json" });
      const record = {
        affId: affId,
        name: name,
        email: email,
        // The StockNetwork site number that this affiliate's accommodation
        // booking link is tied to. Admin-set only — shown read-only in the
        // affiliate's own Hub (Account Details tab).
        siteNr: siteNr,
        // Not editable from this admin form (yet) — preserve whatever the
        // affiliate has set for themselves via their Hub's Account Details
        // tab, rather than silently wiping it out on every admin save.
        phone: (existing && existing.phone) || "",
        revenueShare: revenueShare,
        bank: bank,
        notes: notes,
        status: status,
        totalRevenue: (existing && existing.totalRevenue) || 0,
        totalOwed: (existing && existing.totalOwed) || 0,
        totalPaid: (existing && existing.totalPaid) || 0,
        channelRevenue: (existing && existing.channelRevenue) || {},
        createdAt: (existing && existing.createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await directoryStore.setJSON(affId, record);
      return json({ ok: true, affiliate: record }, 200, cors);
    }

    if (action === "setDefaultHook") {
      const n = Number(body.hook);
      if (!isFinite(n) || n < 1 || n > DEFAULT_HOOK_COUNT) {
        return json({ ok: false, error: "invalid hook number" }, 400, cors);
      }
      const booking = typeof body.booking === "string" ? body.booking.trim() : "";
      const landing = typeof body.landing === "string" ? body.landing.trim() : "";
      const record = { booking: booking, landing: landing, updatedAt: new Date().toISOString() };
      await hookStore.setJSON("__admin__:" + n, record);
      return json({ ok: true, hook: n, record: record }, 200, cors);
    }

    if (action === "deleteAffiliate") {
      const affId = typeof body.affId === "string" ? body.affId.trim() : "";
      if (!affId) return json({ ok: false, error: "missing affId" }, 400, cors);
      await directoryStore.delete(affId);
      await payoutStore.delete(affId);
      return json({ ok: true }, 200, cors);
    }

    if (action === "addPayoutEntry") {
      const affId = typeof body.affId === "string" ? body.affId.trim() : "";
      if (!affId) return json({ ok: false, error: "missing affId" }, 400, cors);
      const period = typeof body.period === "string" ? body.period.trim() : "";
      const revenue = Number(body.revenue);
      const channel = typeof body.channel === "string" ? body.channel.trim() : "";
      if (!CHANNEL_KEYS.includes(channel)) {
        return json({ ok: false, error: "Please select a revenue channel." }, 400, cors);
      }
      if (!period) return json({ ok: false, error: "Please enter a period label (e.g. August 2026)." }, 400, cors);
      if (!isFinite(revenue) || revenue < 0) {
        return json({ ok: false, error: "Please enter a valid revenue amount." }, 400, cors);
      }
      const note = typeof body.note === "string" ? body.note.trim() : "";

      let affiliate = await directoryStore.get(affId, { type: "json" });
      if (!affiliate) return json({ ok: false, error: "Unknown affiliate — add them first." }, 404, cors);
      affiliate = withChannelRevenue(withRevenueShare(affiliate));

      const channelShare = (affiliate.revenueShare && affiliate.revenueShare[channel]) || { type: "percent", value: 0 };
      const owed =
        channelShare.type === "amount"
          ? Math.round(channelShare.value * 100) / 100
          : Math.round(revenue * (channelShare.value / 100) * 100) / 100;

      const entries = (await payoutStore.get(affId, { type: "json" })) || [];
      const entry = {
        id: randomToken().slice(0, 12),
        period: period,
        channel: channel,
        revenue: revenue,
        shareType: channelShare.type,
        shareValue: channelShare.value,
        sharePct: channelShare.type === "percent" ? channelShare.value : null, // kept for older UI/reporting
        owed: owed,
        note: note,
        paid: false,
        paidAt: null,
        createdAt: new Date().toISOString(),
      };
      entries.unshift(entry);
      await payoutStore.setJSON(affId, entries);

      affiliate.totalRevenue = (affiliate.totalRevenue || 0) + revenue;
      affiliate.totalOwed = (affiliate.totalOwed || 0) + owed;
      affiliate.channelRevenue[channel] = (affiliate.channelRevenue[channel] || 0) + revenue;
      affiliate.updatedAt = new Date().toISOString();
      await directoryStore.setJSON(affId, affiliate);

      return json({ ok: true, entry: entry, affiliate: affiliate }, 200, cors);
    }

    if (action === "markPayoutPaid") {
      const affId = typeof body.affId === "string" ? body.affId.trim() : "";
      const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
      const paid = !!body.paid;
      if (!affId || !entryId) return json({ ok: false, error: "missing affId or entryId" }, 400, cors);

      const entries = (await payoutStore.get(affId, { type: "json" })) || [];
      const entry = entries.find(function (e) { return e.id === entryId; });
      if (!entry) return json({ ok: false, error: "Entry not found." }, 404, cors);

      const affiliate = await directoryStore.get(affId, { type: "json" });

      if (paid && !entry.paid) {
        entry.paid = true;
        entry.paidAt = new Date().toISOString();
        if (affiliate) affiliate.totalPaid = (affiliate.totalPaid || 0) + entry.owed;
      } else if (!paid && entry.paid) {
        entry.paid = false;
        entry.paidAt = null;
        if (affiliate) affiliate.totalPaid = Math.max(0, (affiliate.totalPaid || 0) - entry.owed);
      }

      await payoutStore.setJSON(affId, entries);
      if (affiliate) {
        affiliate.updatedAt = new Date().toISOString();
        await directoryStore.setJSON(affId, affiliate);
      }

      return json({ ok: true, entry: entry }, 200, cors);
    }

    if (action === "deletePayoutEntry") {
      const affId = typeof body.affId === "string" ? body.affId.trim() : "";
      const entryId = typeof body.entryId === "string" ? body.entryId.trim() : "";
      if (!affId || !entryId) return json({ ok: false, error: "missing affId or entryId" }, 400, cors);

      const entries = (await payoutStore.get(affId, { type: "json" })) || [];
      const idx = entries.findIndex(function (e) { return e.id === entryId; });
      if (idx === -1) return json({ ok: false, error: "Entry not found." }, 404, cors);
      const removed = entries.splice(idx, 1)[0];
      await payoutStore.setJSON(affId, entries);

      let affiliate = await directoryStore.get(affId, { type: "json" });
      if (affiliate) {
        affiliate = withChannelRevenue(affiliate);
        affiliate.totalRevenue = Math.max(0, (affiliate.totalRevenue || 0) - removed.revenue);
        affiliate.totalOwed = Math.max(0, (affiliate.totalOwed || 0) - removed.owed);
        if (removed.paid) affiliate.totalPaid = Math.max(0, (affiliate.totalPaid || 0) - removed.owed);
        if (removed.channel && CHANNEL_KEYS.includes(removed.channel)) {
          affiliate.channelRevenue[removed.channel] = Math.max(0, (affiliate.channelRevenue[removed.channel] || 0) - removed.revenue);
        }
        affiliate.updatedAt = new Date().toISOString();
        await directoryStore.setJSON(affId, affiliate);
      }

      return json({ ok: true }, 200, cors);
    }

    return json({ ok: false, error: "unknown action" }, 400, cors);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500, cors);
  }
};

export const config = { path: "/api/admin" };
