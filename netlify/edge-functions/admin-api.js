import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";
import { generateHashtags } from "./lib/hashtag-helper.js";
import { fetchResortInfo, draftHookCaption } from "./lib/hook-source.js";
// Aliased — this file already has its own sha256Hex(str) below, used for
// password hashing (string input, not an image buffer); the shared one
// from lib/image-hash.js hashes raw bytes, a different job worth keeping
// separate rather than merging into one function with branching for both.
import { sha256Hex as sha256HexBytes } from "./lib/image-hash.js";
import { mergeIntoRecord } from "./lib/record-merge.js";
import { isShortLink, resolveShortLink, findExistingShortLink, createShortLink } from "./lib/short-link.js";
import { correctBookingLinkSiteId, ADMIN_MASTER_SITE_GUID } from "./lib/booking-link.js";
import { resolveHookMode } from "./lib/hook-mode.js";
import { ZONES } from "./lib/zones.js";
import {
  parseStockNetworkCsv,
  normalizeStockNetworkStatus,
  parseMoney,
  parseUsDateToYmd,
  periodBounds,
  aggregateTransactions,
  buildLeaderboard,
  loadAffiliatesAndTransactions,
  fetchAllRecords,
  mapWithConcurrency,
  CHANNEL_KEYS as STATS_CHANNEL_KEYS,
} from "./lib/booking-stats.js";

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

function sanitizeAlias_(v) {
  return (typeof v === "string" ? v : "").trim().toLowerCase();
}

// Turns whatever cellphone format StockNetwork emails contain into a
// Green-API chatId. Assumes South African numbers when no country code is
// present (a bare leading 0 becomes 27), since that's this business's
// market — adjust here if that assumption ever needs to change.
function normalizeChatId_(raw) {
  if (!raw || typeof raw !== "string") return "";
  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (!raw.trim().startsWith("+") && digits.startsWith("0")) {
    digits = "27" + digits.slice(1);
  }
  if (digits.length < 10) return "";
  return digits + "@c.us";
}

// Accepts a list of { chatId, label } (or bare strings) from the client and
// turns it into a clean, deduped list ready to store. An entry already
// ending in @g.us (a group) or @c.us (an individual chat) is kept as-is;
// anything else is treated as a phone number and run through
// normalizeChatId_ the same way an incoming booking's guest cellphone is.
// Caps at 10 — this is meant for a handful of real recipients per
// affiliate, not an unbounded broadcast list.
function normalizeRecipients_(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (out.length >= 10) break;
    const raw = typeof entry === "string" ? entry : (entry && entry.chatId) || "";
    const label = typeof entry === "object" && entry && typeof entry.label === "string" ? entry.label.trim().slice(0, 60) : "";
    let chatId = raw.trim();
    if (!chatId) continue;
    if (!chatId.endsWith("@g.us") && !chatId.endsWith("@c.us")) {
      chatId = normalizeChatId_(chatId);
    }
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    out.push({ chatId, label });
  }
  return out;
}

function formatGroupMessage_(b) {
  const ref = b.paymentRef || b.refNo || "?";
  return (
    "🏨 *New Booking*\n" +
    "Ref: *" + ref + "*\n" +
    "Guest: " + (b.name || "?") + "\n" +
    "Cell: " + (b.cellphone || "?") + "\n" +
    "Email: " + (b.email || "?") + "\n" +
    "Resort: " + (b.resort || "(check email — could not auto-read)") + "\n" +
    "Dates: " + (b.fromDate || "?") + " to " + (b.toDate || "?") + "\n\n" +
    "_First agent to respond services this client._"
  );
}

function formatClientMessage_(b) {
  const ref = b.paymentRef || b.refNo || "";
  return (
    "🏨 *Booking Confirmation — Avante Travel*\n\n" +
    "Hi " + (b.name || "there") + ", thank you for your booking!\n\n" +
    (ref ? "*Reference:* " + ref + "\n" : "") +
    "*Resort:* " + (b.resort || "-") + "\n" +
    "*Check-in:* " + (b.fromDate || "-") + "\n" +
    "*Check-out:* " + (b.toDate || "-") + "\n\n" +
    "One of our agents will be in touch shortly if there's anything further needed. " +
    "If you have any questions in the meantime, just reply to this message."
  );
}

async function sendGreenApiMessage_(chatId, message) {
  const instanceId = Deno.env.get("GREEN_API_INSTANCE_ID") || "";
  const token = Deno.env.get("GREEN_API_TOKEN") || "";
  if (!instanceId || !token) {
    return { ok: false, status: 0, body: "Green-API credentials are not configured on the server (GREEN_API_INSTANCE_ID / GREEN_API_TOKEN)." };
  }
  const url = "https://api.green-api.com/waInstance" + instanceId + "/sendMessage/" + token;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: chatId, message: message }),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (err) {
    return { ok: false, status: 0, body: String((err && err.message) || err) };
  }
}

async function appendWhatsappLog_(store, entry) {
  const list = (await store.get("recent", { type: "json" })) || [];
  list.unshift(entry);
  if (list.length > 200) list.length = 200;
  await store.setJSON("recent", list);
}

// Turns the per-recipient send results into one short, readable string for
// the log — e.g. "Backup Number: Green-API error 401 Unauthorized" — so a
// FAILED badge in the admin UI can show *why*, not just *that* it failed.
// Green-API's own error bodies are often raw JSON/HTML, so this keeps only
// the first line and caps length rather than dumping the whole response.
function summarizeRecipientFailures_(recipients) {
  const failed = (recipients || []).filter((r) => !r.ok);
  if (!failed.length) return "";
  return failed
    .map((r) => {
      const who = r.label || r.chatId || "recipient";
      const reason = (r.error || r.detail || "unknown error").toString().split("\n")[0].slice(0, 150);
      return who + ": " + reason;
    })
    .join(" | ")
    .slice(0, 500);
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

// Shared by fixCollapsedHookLinks and fixMisattributedHookLinks: scan
// every hook in hookStore, ask `checkAndFix` what (if anything) needs to
// change for each one, and either report or apply it. Each hook's own
// read/check/write is independently caught — one hook's failure can't
// abort the whole batch or hide what happened to every other hook run
// concurrently alongside it (same reasoning as importStockNetworkReport's
// row loop). The returned `changes` list only ever records a hook once
// its fix has actually landed (or, on a dry run, once checkAndFix
// confirmed one is needed) — never speculatively before that.
//
// checkAndFix(key, record) returns null if this hook needs no change, or
// { updatedRecord, changeInfo } — updatedRecord is what gets written
// (dryRun permitting), changeInfo is merged into `{ key, ...changeInfo }`
// for this hook's entry in the returned changes list.
async function scanAndFixHooks(hookStore, dryRun, checkAndFix) {
  const { blobs } = await hookStore.list();
  const changes = [];
  let writeErrors = 0;
  await mapWithConcurrency(blobs, async (b) => {
    try {
      const record = await hookStore.get(b.key, { type: "json" }).catch(() => null);
      if (!record) return;
      const result = await checkAndFix(b.key, record);
      if (!result) return;
      if (!dryRun) {
        await hookStore.setJSON(b.key, result.updatedRecord);
      }
      changes.push({ key: b.key, ...result.changeInfo });
    } catch (e) {
      writeErrors++;
    }
  });
  return { changes, writeErrors };
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
  // Same store resorts-api.js writes the uploaded resort master CSV to —
  // read here (never written) so generateHookDraft's "area" mode can find
  // which real properties sit in a given district without a second fetch.
  const resortStore = getStore({ name: "resort-list", consistency: "strong" });
  const whatsappLogStore = getStore({ name: "whatsapp-log", consistency: "strong" });
  // One blob per imported booking, keyed by StockNetwork's RefNo, so
  // re-importing an overlapping date range (or a report with repeated rows,
  // which StockNetwork's export sometimes has) updates the same record
  // instead of creating a duplicate.
  const transactionsStore = getStore({ name: "stocknetwork-transactions", consistency: "strong" });
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
            caption: (rec && rec.caption) || "",
            hashtags: (rec && rec.hashtags) || null,
            galleryCount: (rec && rec.galleryCount) || 0,
            source: (rec && rec.source) || null,
            updatedAt: (rec && rec.updatedAt) || null,
          });
        }
        return json({ ok: true, hooks: hooks }, 200, cors);
      }

      if (resource === "whatsappLog") {
        const list = (await whatsappLogStore.get("recent", { type: "json" })) || [];
        return json({ ok: true, entries: list }, 200, cors);
      }

      if (resource === "bookingStats") {
        const { affiliatesById, records } = await loadAffiliatesAndTransactions(directoryStore, transactionsStore);

        const periods = periodBounds();
        const stats = aggregateTransactions(records, periods);

        const leaderboard = {};
        for (const p of Object.keys(stats)) {
          leaderboard[p] = {};
          for (const ch of Object.keys(stats[p])) {
            leaderboard[p][ch] = buildLeaderboard(stats[p][ch], affiliatesById);
          }
        }

        const affiliateNames = {};
        for (const affId of Object.keys(affiliatesById)) {
          affiliateNames[affId] = affiliatesById[affId].name || affId;
        }

        return json(
          {
            ok: true,
            periods: periods,
            channels: STATS_CHANNEL_KEYS,
            stats: stats,
            leaderboard: leaderboard,
            affiliateNames: affiliateNames,
            affiliateSiteNr: Object.fromEntries(
              Object.keys(affiliatesById).map((id) => [id, affiliatesById[id].siteNr || ""])
            ),
            transactionCount: records.length,
          },
          200,
          cors
        );
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

    if (action === "sendBookingWhatsapp") {
      // Called by the Google Apps Script Gmail watcher, not a logged-in
      // admin browser session — so it authenticates with its own long
      // shared secret instead of a session token.
      const botKey = typeof body.botKey === "string" ? body.botKey : "";
      const expectedKey = Deno.env.get("WHATSAPP_BOT_KEY") || "";
      if (!expectedKey || botKey !== expectedKey) {
        return json({ ok: false, error: "Not authorized." }, 401, cors);
      }

      const alias = sanitizeAlias_(body.alias || "");
      const booking = body.booking && typeof body.booking === "object" ? body.booking : {};
      const bookingStatus = typeof booking.status === "string" ? booking.status : "unknown";

      // Find the affiliate whose bookingEmailAlias matches the address this
      // booking email was addressed to (e.g. jeanl1967+aff123@gmail.com).
      let matched = null;
      if (alias) {
        const { blobs } = await directoryStore.list();
        for (const b of blobs) {
          const rec = await directoryStore.get(b.key, { type: "json" });
          if (rec && rec.bookingEmailAlias && sanitizeAlias_(rec.bookingEmailAlias) === alias) {
            matched = rec;
            break;
          }
        }
      }

      // Affiliates can choose (in the WhatsApp Messaging tab) to only be
      // notified for "request" bookings, "booked" ones, "confirmed" ones,
      // "paid" ones, or any combination. Affiliates set up before this
      // control existed have no whatsappNotifyOn field, which is treated as
      // "notify on everything" so nothing that already worked silently
      // stops working.
      const notifyOn =
        matched && Array.isArray(matched.whatsappNotifyOn) && matched.whatsappNotifyOn.length
          ? matched.whatsappNotifyOn
          : ["request", "booked", "confirmed", "paid"];

      if (matched && bookingStatus !== "unknown" && !notifyOn.includes(bookingStatus)) {
        context.waitUntil(
          appendWhatsappLog_(whatsappLogStore, {
            at: new Date().toISOString(),
            alias: alias,
            affId: matched.affId,
            affName: matched.name,
            refNo: booking.paymentRef || booking.refNo || "",
            guest: booking.name || "",
            resort: booking.resort || "",
            status: bookingStatus,
            skipped: true,
            groupOk: false,
            clientOk: false,
          })
        );
        return json(
          {
            ok: true,
            matchedAffId: matched.affId,
            skipped: true,
            reason: `Affiliate is not subscribed to "${bookingStatus}" status bookings.`,
          },
          200,
          cors
        );
      }

      // No match (e.g. the original un-aliased address, or a new affiliate
      // not set up yet) falls back to a default group, so existing behavior
      // keeps working during the transition to per-affiliate aliases.
      const defaultGroupId = Deno.env.get("DEFAULT_WHATSAPP_GROUP_ID") || "";
      const recipients =
        matched && Array.isArray(matched.whatsappRecipients) && matched.whatsappRecipients.length
          ? matched.whatsappRecipients
          : matched && matched.whatsappGroupId
          ? [{ chatId: matched.whatsappGroupId, label: "" }]
          : defaultGroupId
          ? [{ chatId: defaultGroupId, label: "default" }]
          : [];

      const result = { ok: true, matchedAffId: matched ? matched.affId : null, recipients: [], client: null };

      if (recipients.length) {
        for (const r of recipients) {
          const send = await sendGreenApiMessage_(r.chatId, formatGroupMessage_(booking));
          result.recipients.push({ chatId: r.chatId, label: r.label || "", ok: send.ok, status: send.status, detail: send.ok ? undefined : send.body });
        }
      } else {
        result.recipients.push({ ok: false, error: "No WhatsApp recipients configured for this alias, and no default group set." });
      }

      const clientChatId = normalizeChatId_(booking.cellphone || "");
      if (clientChatId) {
        const send2 = await sendGreenApiMessage_(clientChatId, formatClientMessage_(booking));
        result.client = { chatId: clientChatId, ok: send2.ok, status: send2.status, detail: send2.ok ? undefined : send2.body };
      } else {
        result.client = { ok: false, error: "No usable cellphone number extracted from the booking email." };
      }

      context.waitUntil(
        appendWhatsappLog_(whatsappLogStore, {
          at: new Date().toISOString(),
          alias: alias,
          affId: matched ? matched.affId : null,
          affName: matched ? matched.name : null,
          refNo: booking.paymentRef || booking.refNo || "",
          guest: booking.name || "",
          resort: booking.resort || "",
          status: bookingStatus,
          groupOk: result.recipients.length > 0 && result.recipients.every((r) => r.ok),
          groupCount: result.recipients.length,
          groupError: summarizeRecipientFailures_(result.recipients),
          clientOk: !!(result.client && result.client.ok),
          clientError: result.client && !result.client.ok ? (result.client.error || (result.client.detail || "").toString().split("\n")[0].slice(0, 150)) : "",
        })
      );

      return json(result, 200, cors);
    }

    if (action === "importStockNetworkReport") {
      // Called either from a logged-in admin browser session (the Bookings
      // tab's "Upload Report" button) or from the daily Gmail-report import
      // pipeline, which has no live browser session — so, like
      // sendBookingWhatsapp above, it may authenticate with a shared secret
      // instead of a session token. STOCKNETWORK_IMPORT_KEY was provisioned
      // 2026-09-06 — this comment exists mainly to force a fresh deploy, so
      // Edge Functions actually pick up that new env var (they don't reload
      // one on an existing deploy without a redeploy).
      const importKey = typeof body.importKey === "string" ? body.importKey : "";
      const expectedImportKey = Deno.env.get("STOCKNETWORK_IMPORT_KEY") || "";
      const viaSharedKey = !!expectedImportKey && importKey === expectedImportKey;
      const viaSession = !viaSharedKey && (await verifyToken(body.token));
      if (!viaSharedKey && !viaSession) {
        return json({ ok: false, error: "Not authorized." }, 401, cors);
      }

      const csvText = typeof body.csvText === "string" ? body.csvText : "";
      if (!csvText.trim()) return json({ ok: false, error: "No CSV content received." }, 400, cors);
      const sourceLabel = typeof body.sourceLabel === "string" ? body.sourceLabel.trim().slice(0, 200) : "";
      // Only the accommodation report exists so far — see CHANNEL_KEYS /
      // STATS_CHANNEL_KEYS for the other channels this same pipeline will
      // handle once their own StockNetwork exports are available.
      const channel = STATS_CHANNEL_KEYS.includes(body.channel) ? body.channel : "accommodation";

      const rows = parseStockNetworkCsv(csvText);
      if (!rows.length) {
        return json({ ok: false, error: "Couldn't find any booking rows in that file." }, 400, cors);
      }

      // Site Nr -> affiliate lookup, built once per import. Fetched
      // concurrently (bounded) rather than one directoryStore.get() at a
      // time — with dozens of affiliates that for-loop was the difference
      // between a handful of round trips overlapping and all of them
      // serialized end-to-end before a single CSV row could even start.
      // siteToAff itself is still built afterward, as one ordered pass
      // over the fetched records (not from inside each concurrent
      // fetch) — Site Nr is a free-text admin field, not a directory
      // record's key, so two affiliates could end up sharing one by
      // typo; if that ever happens, which one wins should stay whichever
      // comes later in directoryStore.list()'s own order, the same every
      // run, not whichever concurrent fetch happened to resolve last.
      const affRecords = await fetchAllRecords(directoryStore);
      const siteToAff = {};
      for (const rec of affRecords) {
        if (rec && rec.siteNr) siteToAff[String(rec.siteNr).trim()] = rec;
      }

      let created = 0;
      let updated = 0;
      let unchanged = 0;
      let unmatchedSite = 0;
      let skippedNoRef = 0;
      const seenInFile = new Set();

      // Pass 1 — pure in-memory work (dedup by RefNo, match the affiliate):
      // must run in row order so "first occurrence of a repeated RefNo
      // wins" stays deterministic, but touches no store, so it's fast
      // regardless of how many rows there are.
      const toWrite = [];
      for (const row of rows) {
        const refNo = (row.RefNo || "").trim();
        if (!refNo) {
          skippedNoRef++;
          continue;
        }
        // StockNetwork's export sometimes repeats the exact same row more
        // than once within a single file — collapse those here rather than
        // writing the same transaction three times in a row.
        if (seenInFile.has(refNo)) continue;
        seenInFile.add(refNo);

        const site = (row.Site || "").trim();
        const aff = siteToAff[site];
        if (!aff) {
          unmatchedSite++;
          continue;
        }
        toWrite.push({ row, refNo, site, aff });
      }

      // Pass 2 — the actual store round trips (one read + one write per
      // row, each a distinct RefNo key so none of these can collide with
      // each other), run with bounded concurrency instead of one row at a
      // time. created/updated/unchanged are plain counters incremented by
      // a single synchronous statement per row — safe under this
      // concurrency since JS never interleaves mid-statement, only at
      // await points. Each row catches its own failure rather than
      // letting it reject the whole mapWithConcurrency batch — a bad row
      // (a transient store error, say) would otherwise abort the request
      // with a 500 while every other row's write is still in flight,
      // uncounted and unconfirmed either way; this way a single bad row
      // is simply skipped and reported, everything else still lands.
      let writeErrors = 0;
      await mapWithConcurrency(toWrite, async ({ row, refNo, site, aff }) => {
        try {
          const status = normalizeStockNetworkStatus(row.Name, row["Confirmed On"]);
          const record = {
            refNo: refNo,
            channel: channel,
            site: site,
            affId: aff.affId,
            status: status,
            amountIncl: parseMoney(row["Total Amount Incl."]),
            currency: row.Currency || "ZAR",
            transactionDate: parseUsDateToYmd(row["Transaction Date"]),
            confirmedOn: parseUsDateToYmd(row["Confirmed On"]),
            guestName: row.Fullname || "",
            guestEmail: row.EmailAddress || "",
            resortName: row["Resort Name"] || "",
            unitType: row["Unit Type"] || "",
            checkIn: parseUsDateToYmd(row["Check In Date"]),
            checkOut: parseUsDateToYmd(row["Check Out Date"]),
            nights: Number(row.Nights) || 0,
            companyName: row.CompanyName || "",
            customerReference: row.CustomerReference || "",
            sourceLabel: sourceLabel,
            importedAt: new Date().toISOString(),
          };

          const existing = await transactionsStore.get(refNo, { type: "json" });
          // Decide the outcome now, but don't count it until the write
          // below actually succeeds — otherwise a setJSON that throws
          // would land in both a success counter (created/updated/
          // unchanged) and writeErrors for the same row, double-counting
          // it and inflating the summary while the record was never
          // actually persisted.
          let outcome;
          if (existing) {
            record.firstImportedAt = existing.firstImportedAt || existing.importedAt;
            const changed =
              existing.status !== record.status ||
              existing.amountIncl !== record.amountIncl ||
              existing.confirmedOn !== record.confirmedOn;
            outcome = changed ? "updated" : "unchanged";
          } else {
            record.firstImportedAt = record.importedAt;
            outcome = "created";
          }
          await transactionsStore.setJSON(refNo, record);
          if (outcome === "created") created++;
          else if (outcome === "updated") updated++;
          else unchanged++;
        } catch (e) {
          writeErrors++;
        }
      });

      return json(
        {
          ok: true,
          summary: {
            totalRows: rows.length,
            created: created,
            updated: updated,
            unchanged: unchanged,
            unmatchedSite: unmatchedSite,
            skippedNoRef: skippedNoRef,
            writeErrors: writeErrors,
          },
        },
        200,
        cors
      );
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
      const zones = Array.isArray(body.zones)
        ? [...new Set(body.zones.filter((z) => typeof z === "string" && ZONES.includes(z)))]
        : [];
      const ALLOWED_TYPES = ["franchise", "property", "agent"];
      const types = Array.isArray(body.types)
        ? [...new Set(body.types.filter((t) => ALLOWED_TYPES.includes(t)))]
        : [];
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
        zones: zones,
        // Kept in sync with zones[0] so anything still reading the old
        // singular field (e.g. a stale cached client) degrades gracefully
        // rather than breaking outright.
        zone: zones[0] || "",
        types: types,
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

    if (action === "setWhatsappRouting") {
      // Separate from upsertAffiliate on purpose: upsertAffiliate rewrites
      // the whole record from the Affiliates tab's form fields, which
      // don't include these two — saving from the WhatsApp Messaging tab
      // must only touch bookingEmailAlias/whatsappGroupId, never wipe out
      // the affiliate's name, share, bank details, etc.
      const affId = typeof body.affId === "string" ? body.affId.trim() : "";
      if (!affId) return json({ ok: false, error: "missing affId" }, 400, cors);
      const existing = await directoryStore.get(affId, { type: "json" });
      if (!existing) return json({ ok: false, error: "Unknown affiliate." }, 404, cors);
      existing.bookingEmailAlias = sanitizeAlias_(body.bookingEmailAlias || "");
      existing.whatsappRecipients = normalizeRecipients_(body.whatsappRecipients);
      // Kept in sync with the first recipient so anything still reading the
      // old singular field (e.g. a stale cached client) degrades gracefully
      // rather than breaking outright.
      existing.whatsappGroupId = (existing.whatsappRecipients[0] && existing.whatsappRecipients[0].chatId) || "";
      if (Array.isArray(body.notifyOn)) {
        const cleaned = body.notifyOn.filter(
          (s) => s === "request" || s === "booked" || s === "confirmed" || s === "paid"
        );
        existing.whatsappNotifyOn = cleaned.length ? cleaned : ["request", "booked", "confirmed", "paid"];
      } else if (!Array.isArray(existing.whatsappNotifyOn) || !existing.whatsappNotifyOn.length) {
        existing.whatsappNotifyOn = ["request", "booked", "confirmed", "paid"];
      }
      existing.updatedAt = new Date().toISOString();
      await directoryStore.setJSON(affId, existing);
      return json({ ok: true, affiliate: existing }, 200, cors);
    }

    if (action === "listWhatsappGroups") {
      const instanceId = Deno.env.get("GREEN_API_INSTANCE_ID") || "";
      const token = Deno.env.get("GREEN_API_TOKEN") || "";
      if (!instanceId || !token) {
        return json({ ok: false, error: "Green-API credentials are not configured on the server." }, 400, cors);
      }
      try {
        const url = "https://api.green-api.com/waInstance" + instanceId + "/getChats/" + token;
        const res = await fetch(url);
        const chats = await res.json();
        const groups = (Array.isArray(chats) ? chats : []).filter((c) => c && c.id && c.id.endsWith("@g.us"));
        return json({ ok: true, groups: groups }, 200, cors);
      } catch (err) {
        return json({ ok: false, error: String((err && err.message) || err) }, 502, cors);
      }
    }

    if (action === "testWhatsappGroup") {
      const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
      if (!groupId) return json({ ok: false, error: "Enter a WhatsApp group chat ID first." }, 400, cors);
      const send = await sendGreenApiMessage_(
        groupId,
        "✅ Test message from Avante Admin — WhatsApp Messaging is wired up correctly."
      );
      return json({ ok: send.ok, status: send.status, detail: send.body }, send.ok ? 200 : 502, cors);
    }

    if (action === "generateHookDraft") {
      // Builds a hook's caption + hashtags + candidate photos + booking
      // link from just a property or an area — nothing is saved here, this
      // only returns a draft for the admin to review and (optionally) hand
      // to setDefaultHook below. The existing manual fields/flow are
      // completely untouched by this action; it's purely an added option
      // that pre-fills the same fields a manual save already uses.
      // A single free-text field drives this — the admin never has to say
      // "this is a property" vs "this is an area" up front. If the client
      // already resolved an exact resortId (e.g. the admin picked one from
      // the datalist), that's used directly; otherwise the query is
      // resolved server-side against the resort list: an exact or partial
      // property-name match wins first, and only falls back to a
      // district/area match if nothing named that was found.
      const bodyResortId = typeof body.resortId === "string" ? body.resortId.trim() : "";
      const bodySiteId = typeof body.siteId === "string" ? body.siteId.trim() : "";
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!bodyResortId && !query) {
        return json({ ok: false, error: "Type or pick a property or area first." }, 400, cors);
      }

      let mode = "property";
      let label = query;
      let sources = [];

      if (bodyResortId) {
        const info = await fetchResortInfo(bodyResortId, bodySiteId);
        if (!info) {
          return json(
            { ok: false, error: "Couldn't load that property's info page. Try again, or pick a different one." },
            502,
            cors
          );
        }
        sources = [info];
        label = info.name || label;
      } else {
        const listRecord = await resortStore.get("current", { type: "json" });
        const allResorts = listRecord && Array.isArray(listRecord.resorts) ? listRecord.resorts : [];
        const queryLower = query.toLowerCase();

        let propertyMatch = allResorts.find((r) => r.name && r.name.toLowerCase() === queryLower);
        // Only fall back to a loose "name contains this text" match if there
        // isn't an exact area match available. Without this check, typing an
        // area name like "Knysna" could wrongly match a property whose name
        // happens to contain that word (e.g. "63 Milkwood Knysna") instead
        // of correctly building an area-wide draft — confirmed live before
        // this fix shipped.
        if (!propertyMatch) {
          const hasExactDistrictMatch = allResorts.some(
            (r) => r.district && r.district.toLowerCase() === queryLower
          );
          if (!hasExactDistrictMatch) {
            propertyMatch = allResorts.find((r) => r.name && r.name.toLowerCase().includes(queryLower));
          }
        }

        if (propertyMatch) {
          label = propertyMatch.name;
          const info = await fetchResortInfo(propertyMatch.resortId, propertyMatch.siteId);
          if (!info) {
            return json(
              { ok: false, error: "Couldn't load that property's info page. Try again, or pick a different one." },
              502,
              cors
            );
          }
          sources = [info];
        } else {
          mode = "area";
          let matches = allResorts.filter((r) => r.district && r.district.toLowerCase() === queryLower);
          if (!matches.length) {
            matches = allResorts.filter((r) => r.district && r.district.toLowerCase().includes(queryLower));
          }
          if (!matches.length) {
            return json(
              { ok: false, error: 'Couldn\'t find a property or area matching "' + query + '" in the resort list.' },
              404,
              cors
            );
          }

          // StockNetwork lists the same physical resort under multiple
          // SiteIDs — dedupe by ResortID so an area draft draws on distinct
          // properties, not the same one three times.
          const seenResortIds = new Set();
          const distinct = [];
          for (const r of matches) {
            if (!r.resortId || seenResortIds.has(r.resortId)) continue;
            seenResortIds.add(r.resortId);
            distinct.push(r);
            if (distinct.length >= 5) break;
          }

          const fetched = await Promise.all(distinct.map((r) => fetchResortInfo(r.resortId, r.siteId)));
          sources = fetched.filter(Boolean);
          if (!sources.length) {
            return json(
              { ok: false, error: "Couldn't load property info for that area right now. Try again shortly." },
              502,
              cors
            );
          }
        }
      }

      const caption = await draftHookCaption({ mode: mode, label: label, sources: sources });
      // Reuses the exact same hashtag generator setDefaultHook already
      // calls — hashtags stay consistent no matter how the caption got
      // written.
      const hashtags = caption ? await generateHashtags(caption) : null;

      // Pool candidate photos across every source, deduped, capped at 12 —
      // real StockNetwork listing photography, not stock images.
      const photos = [];
      outer: for (const s of sources) {
        for (const url of s.images) {
          if (!photos.includes(url)) photos.push(url);
          if (photos.length >= 12) break outer;
        }
      }

      // Built off ADMIN_MASTER_SITE_GUID — Jean's own real StockNetwork
      // site GUID, used as a placeholder — which hook-api.js's
      // personalizeStockNetworkUrl already swaps for whichever affiliate
      // is actually viewing the hook. Dates default to one month out for a
      // one-night stay — a viewer picks their own dates on the landing
      // page before booking; this is only the fallback if they don't.
      const today = new Date();
      const checkIn = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()));
      const checkOut = new Date(checkIn.getTime() + 86400000);
      const fmtDate = (d) => d.toISOString().slice(0, 10);
      const bookingParams = new URLSearchParams({
        CheckInDT: fmtDate(checkIn),
        CheckOutDT: fmtDate(checkOut),
        Filter: label,
      });
      const booking =
        "https://stock.stocknetwork.co.za/ui/" + encodeURIComponent(ADMIN_MASTER_SITE_GUID) + "?" + bookingParams.toString();

      // Merged real content from every source — carried back to the client
      // so a later saveHookPhotos call can persist it onto the hook record
      // without re-scraping. This is what powers the landing page's "full
      // details" (description/attractions/room type) and the "Built from"
      // label on the hook card.
      const description = sources
        .map((s) => s.description)
        .filter(Boolean)
        .join(" ");
      const attractions = sources
        .map((s) => s.attractions)
        .filter(Boolean)
        .join(" ");
      const roomType = sources.length === 1 ? sources[0].roomType || "" : "";
      const sourceNames = sources.map((s) => s.name).filter(Boolean);

      return json(
        {
          ok: true,
          mode: mode,
          label: label,
          caption: caption || "",
          captionGenerated: !!caption,
          hashtags: hashtags,
          booking: booking,
          photos: photos,
          sourceCount: sources.length,
          sourceNames: sourceNames,
          description: description,
          attractions: attractions,
          roomType: roomType,
        },
        200,
        cors
      );
    }

    if (action === "setDefaultHook") {
      const n = Number(body.hook);
      if (!isFinite(n) || n < 1 || n > DEFAULT_HOOK_COUNT) {
        return json({ ok: false, error: "invalid hook number" }, 400, cors);
      }
      const booking = typeof body.booking === "string" ? body.booking.trim() : "";
      // Booking link and Landing page link ending up set to the exact
      // same short link is the specific mistake fixCollapsedHookLinks
      // exists to clean up (see there for the full story) — guard against
      // writing that state back here too, so it can't be immediately
      // re-created after being fixed.
      const landingRaw = typeof body.landing === "string" ? body.landing.trim() : "";
      const landing = landingRaw && landingRaw === booking && isShortLink(booking) ? "" : landingRaw;
      const caption = typeof body.caption === "string" ? body.caption.trim() : "";
      // Regenerate platform hashtags whenever the default hook is saved.
      // Best-effort: a failed/unavailable AI call just clears the cached
      // set rather than blocking the save.
      const hashtags = await generateHashtags(caption);
      // Preserve everything a normal caption/link edit here has no
      // business touching — galleryCount and source (Auto-build's saved
      // gallery/rich details, set by saveHookPhotos below, not by this
      // form) plus imageHash/aiCaption/aiHashtags/aiImageHash (the AI
      // scan cache set by hook-image.js's upload and
      // hook-share-content.js's scan) — by spreading the existing record
      // first, rather than rebuilding it field-by-field and silently
      // dropping whatever this form doesn't know about.
      const existingForSave = await hookStore.get("__admin__:" + n, { type: "json" });
      const record = {
        ...(existingForSave || {}),
        booking: booking,
        landing: landing,
        caption: caption,
        hashtags: hashtags,
        updatedAt: new Date().toISOString(),
      };
      await hookStore.setJSON("__admin__:" + n, record);
      return json({ ok: true, hook: n, record: record }, 200, cors);
    }

    if (action === "saveHookPhotos") {
      // Transfers admin-picked candidate photos (real StockNetwork listing
      // URLs returned by generateHookDraft) into our own image store, so a
      // hook's photos keep working even if StockNetwork later reshuffles or
      // removes that listing. The first picked photo becomes the hook's
      // normal single "cover" image — the exact same bare aff:hook key
      // hook-image.js and every existing display path already use, so a
      // hook saved this way looks no different to old code than one whose
      // cover photo was uploaded manually. Any additional photos go into
      // new, purely additive numbered slots that only the gallery-aware UI
      // reads — nothing about the existing single-image flow changes.
      const n = Number(body.hook);
      if (!isFinite(n) || n < 1 || n > DEFAULT_HOOK_COUNT) {
        return json({ ok: false, error: "invalid hook number" }, 400, cors);
      }
      const urls = Array.isArray(body.urls)
        ? body.urls.filter((u) => typeof u === "string" && u.trim()).slice(0, 6)
        : [];
      if (!urls.length) return json({ ok: false, error: "No photos selected." }, 400, cors);

      const imageStore = getStore({ name: "promo-hook-images", consistency: "strong" });
      let saved = 0;
      let coverBuf = null; // the exact bytes written to the cover slot ("saved === 0" below), for imageHash
      const failed = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i].trim();
        try {
          const res = await fetch(url);
          if (!res.ok) {
            failed.push(url);
            continue;
          }
          const contentType = res.headers.get("content-type") || "image/jpeg";
          if (!contentType.startsWith("image/")) {
            failed.push(url);
            continue;
          }
          const buf = await res.arrayBuffer();
          if (buf.byteLength > 5 * 1024 * 1024 || buf.byteLength < 1) {
            failed.push(url);
            continue;
          }
          // Keyed by how many photos have actually saved so far (`saved`),
          // not by this URL's original position in `urls` (`i`) — a
          // download failing partway through the batch must not leave a
          // gap between the keys written here and the contiguous 0..N
          // range galleryCount below promises hook-image.js's rotation.
          const isCover = saved === 0;
          const key = isCover ? "__admin__:" + n : "__admin__:" + n + ":" + saved;
          await imageStore.set(key, buf, { metadata: { contentType: contentType, sourceUrl: url } });
          if (isCover) coverBuf = buf;
          saved++;
        } catch (e) {
          failed.push(url);
        }
      }

      const galleryCount = Math.max(0, saved - 1);

      // Every candidate photo can fail to download (dead/expired
      // StockNetwork URLs, a network blip) — saved stays 0 and the
      // response below already reports that as a failure. Don't touch
      // the hook's stored record in that case: this hook may already
      // have a working gallery from an earlier successful save, and
      // unconditionally overwriting galleryCount to 0 here would silently
      // wipe that out (orphaning its still-live image blobs) despite the
      // API telling the caller nothing was saved.
      if (saved > 0) {
        // Only ever read to decide *whether* previously-covered gallery
        // slots need cleaning up below (previousGalleryCount) — never
        // written back directly. sha256HexBytes below is itself an await,
        // so holding this record in memory across it and writing it back
        // wholesale would risk clobbering a concurrent write to this same
        // record (a caption/booking save via setDefaultHook, or an
        // overlapping image upload) — the same lost-update hazard already
        // fixed for hook-image.js and hook-share-content.js. mergeIntoRecord
        // re-reads fresh immediately before writing instead.
        const existing = (await hookStore.get("__admin__:" + n, { type: "json" })) || {};
        const previousGalleryCount = existing.galleryCount || 0;

        const fields = { galleryCount: galleryCount, updatedAt: new Date().toISOString() };
        // The cover image (the "saved === 0" slot above) was just
        // rewritten to a new photo — recompute its hash, and drop any AI
        // caption cached against the old one (hook-share-content.js), so
        // a later "Get Shareable Content" scan doesn't serve a cached
        // caption describing whatever flyer this hook had before, and
        // instead re-scans this new cover.
        if (coverBuf) {
          fields.imageHash = await sha256HexBytes(coverBuf);
          fields.aiCaption = undefined;
          fields.aiHashtags = undefined;
          fields.aiImageHash = undefined;
          fields.aiGeneratedAt = undefined;
        }
        // Optional — carried straight through from generateHookDraft's
        // response rather than re-scraped here, so a hook remembers what
        // property/area it was built from (shown on the hook card and on
        // the new landing page's "full details"). Left untouched if this
        // save didn't come from an Auto-build draft (e.g. a future manual
        // photo save with no source context).
        if (body.source && typeof body.source === "object") {
          fields.source = {
            mode: body.source.mode === "area" ? "area" : "property",
            label: typeof body.source.label === "string" ? body.source.label.trim().slice(0, 200) : "",
            description: typeof body.source.description === "string" ? body.source.description.trim().slice(0, 2000) : "",
            attractions: typeof body.source.attractions === "string" ? body.source.attractions.trim().slice(0, 2000) : "",
            roomType: typeof body.source.roomType === "string" ? body.source.roomType.trim().slice(0, 100) : "",
            names: Array.isArray(body.source.names)
              ? body.source.names.filter((x) => typeof x === "string").slice(0, 10)
              : [],
          };
        }
        await mergeIntoRecord(hookStore, "__admin__:" + n, fields);

        // A previous save may have covered more gallery slots than this
        // one did (e.g. 4 photos saved before, only 2 saved this time) —
        // without this, the extra slots' image blobs would sit in
        // storage forever, orphaned: no longer referenced by galleryCount
        // above, but never deleted either.
        if (previousGalleryCount > galleryCount) {
          const staleSlots = [];
          for (let slot = galleryCount + 1; slot <= previousGalleryCount; slot++) staleSlots.push(slot);
          await mapWithConcurrency(staleSlots, (slot) =>
            imageStore.delete("__admin__:" + n + ":" + slot).catch(() => {})
          );
        }
      }

      return json(
        { ok: saved > 0, saved: saved, failed: failed.length, galleryCount: galleryCount },
        saved > 0 ? 200 : 502,
        cors
      );
    }

    if (action === "fixCollapsedHookLinks") {
      // A hook's Booking link and Landing page link are meant to be two
      // distinct destinations. Both fields ending up set to the exact
      // same go.avantetravel.co.za short link is a specific, recognizable
      // mistake (most likely: the booking link got shortened for sharing
      // and the short result was then pasted into both raw fields instead
      // of just the one meant to be shared) — never a valid, intentional
      // state, and it breaks per-affiliate attribution: hook-api.js's
      // personalizeStockNetworkUrl needs the real ADMIN_MASTER_SITE_GUID
      // booking URL to recognize and personalize, not an opaque short link.
      //
      // Scans every hook this system has — both admin's own defaults
      // (__admin__:1..N) and every affiliate's self-managed ones
      // (<affId>:<n>), since they all live in this one promo-hooks store
      // under the same key shape. For each match, resolves the short link
      // back to the real long URL it was originally shortening (the
      // short-links store keeps that mapping from when it was created)
      // and restores it as the Booking link, clearing Landing page link
      // back to empty — a normal, already-supported "no custom landing"
      // state — rather than leaving it as a broken duplicate. A short
      // link whose original record is gone (so it can't be resolved to
      // anything different) is left untouched rather than guessed at.
      //
      // dryRun (default true unless explicitly false) only reports what
      // would change — nothing is written. The admin UI always runs a
      // dry run first and shows the list before offering to apply it.
      const dryRun = body.dryRun !== false;
      const shortLinksStore = getStore({ name: "short-links", consistency: "strong" });

      const { changes, writeErrors } = await scanAndFixHooks(hookStore, dryRun, async (key, record) => {
        const booking = typeof record.booking === "string" ? record.booking : "";
        const landing = typeof record.landing === "string" ? record.landing : "";
        if (!booking || booking !== landing || !isShortLink(booking)) return null;

        const resolved = await resolveShortLink(booking, shortLinksStore);
        if (resolved === booking) return null; // couldn't resolve to anything different — leave alone

        return {
          updatedRecord: { ...record, booking: resolved, landing: "", updatedAt: new Date().toISOString() },
          changeInfo: { oldLink: booking, newBooking: resolved },
        };
      });

      return json({ ok: true, dryRun: dryRun, count: changes.length, changes: changes, writeErrors: writeErrors }, 200, cors);
    }

    if (action === "fixMisattributedHookLinks") {
      // A self-managed hook's Booking link is used exactly as stored —
      // hook-api.js only ever personalizes an *admin-managed* hook's
      // booking link (source === "admin"); a self-managed one (mode
      // "self", not expired) is returned verbatim, with no correction
      // layer. hub.html's own Accommodation Link Builder always puts the
      // affiliate's own Hub ID as the StockNetwork booking link's site
      // identifier (the "/ui/<id>" path segment) — so if that segment
      // doesn't match the affiliate who actually owns this hook (the
      // affId half of its own "<affId>:<n>" key), the booking was set
      // wrong: pasted from a different affiliate's link, an old example,
      // or similar. Every booking through that hook then attributes to
      // whoever that other id belongs to instead of this affiliate —
      // including a real StockNetwork site number that isn't any
      // registered affiliate at all, if that's what ended up there.
      //
      // Scans every non-admin hook (__admin__:* keys are excluded — an
      // admin default is *supposed* to carry the ADMIN_MASTER_SITE_GUID
      // placeholder, not any specific affiliate's id, a different,
      // already-handled case). correctBookingLinkSiteId only ever touches
      // the exact "/ui/<id>" shape on stock.stocknetwork.co.za — any
      // other link shape (a self-managed hook's booking doesn't have to
      // be a StockNetwork link at all) is left completely untouched. Only
      // that one path segment changes; every query param (dates, Filter)
      // an affiliate already set is preserved.
      //
      // A misattributed booking link can also hide behind one of our own
      // go.avantetravel.co.za short links (the same habit
      // fixCollapsedHookLinks's own comment documents — shortening a link
      // and pasting the short result somewhere raw) — resolve one before
      // checking its site id, same as fixCollapsedHookLinks already does,
      // or this checker would see only "go.avantetravel.co.za" and never
      // recognize the real, wrongly-attributed destination underneath.
      // Only ever rewrites booking to the resolved long form when a
      // genuine correction is needed — an already-correct short link is
      // left exactly as the affiliate set it, not eagerly unshortened.
      //
      // dryRun (default true unless explicitly false) only reports what
      // would change — nothing is written.
      const dryRun = body.dryRun !== false;
      const shortLinksStore = getStore({ name: "short-links", consistency: "strong" });

      const { changes, writeErrors } = await scanAndFixHooks(hookStore, dryRun, async (key, record) => {
        if (key.startsWith("__admin__:")) return null;
        const sep = key.lastIndexOf(":");
        if (sep <= 0) return null;
        const affId = key.slice(0, sep);

        const booking = typeof record.booking === "string" ? record.booking : "";
        if (!booking) return null;

        const resolvedForCheck = isShortLink(booking) ? await resolveShortLink(booking, shortLinksStore) : booking;
        const result = correctBookingLinkSiteId(resolvedForCheck, affId);
        if (!result.changed) return null;

        return {
          updatedRecord: { ...record, booking: result.url, updatedAt: new Date().toISOString() },
          changeInfo: { oldBooking: booking, newBooking: result.url, wrongId: result.previousSiteId },
        };
      });

      return json({ ok: true, dryRun: dryRun, count: changes.length, changes: changes, writeErrors: writeErrors }, 200, cors);
    }

    if (action === "switchHooksToAdminManaged") {
      // "Every affiliate should be set up with admin manages": a hook is
      // already effectively admin-managed by default — hook-api.js's GET
      // (`mode = (affRecord && affRecord.mode) === "self" ? "self" :
      // "admin"`) falls through to "admin" for no record at all, or any
      // mode value other than the literal string "self". The only
      // records that need touching are ones an affiliate explicitly
      // switched to "Manage my own" at some point (mode === "self") —
      // flip those back so every affiliate's storefront shows the
      // (freshly rebuilt, Site-Nr-personalized) admin defaults instead.
      //
      // Deliberately non-destructive: only the mode field changes.
      // Whatever booking/landing/caption/hashtags/gallery an affiliate
      // had set for themselves is left completely untouched in the
      // record — they can switch back to "Manage my own" later and find
      // it exactly as they left it.
      //
      // dryRun (default true unless explicitly false) only reports what
      // would change — nothing is written.
      const dryRun = body.dryRun !== false;

      const { changes, writeErrors } = await scanAndFixHooks(hookStore, dryRun, async (key, record) => {
        if (key.startsWith("__admin__:")) return null;
        if (record.mode !== "self") return null; // already effectively admin-managed

        return {
          updatedRecord: { ...record, mode: "admin", updatedAt: new Date().toISOString() },
          changeInfo: {},
        };
      });

      return json({ ok: true, dryRun: dryRun, count: changes.length, changes: changes, writeErrors: writeErrors }, 200, cors);
    }

    if (action === "clearAllBookingLinks") {
      // Deliberate clean-slate reset, requested so a fresh rebuild of
      // booking links (via the Booking Link Builder) starts from nothing
      // instead of layering new links on top of old ones. Clears the
      // Booking link field on EVERY hook — both admin's own defaults
      // (__admin__:1..N) and every affiliate's own hook record. Unlike
      // fixMisattributedHookLinks and switchHooksToAdminManaged above
      // (which intentionally exclude __admin__:* — a Site Nr or a
      // "Manage my own" toggle only ever makes sense for a real
      // affiliate), this one deliberately includes the admin defaults
      // too, per the request. Landing page link, caption, photos/
      // gallery, and mode are all left completely untouched — only
      // booking is cleared to "".
      //
      // dryRun (default true unless explicitly false) only reports what
      // would change — nothing is written. The admin UI always runs a
      // dry run first and shows the full list before offering to apply
      // it, since this touches every hook in the system at once.
      const dryRun = body.dryRun !== false;

      const { changes, writeErrors } = await scanAndFixHooks(hookStore, dryRun, async (key, record) => {
        const booking = typeof record.booking === "string" ? record.booking : "";
        if (!booking) return null; // already empty — nothing to clear

        return {
          updatedRecord: { ...record, booking: "", updatedAt: new Date().toISOString() },
          changeInfo: { oldBooking: booking },
        };
      });

      return json({ ok: true, dryRun: dryRun, count: changes.length, changes: changes, writeErrors: writeErrors }, 200, cors);
    }

    if (action === "generateShortCodes") {
      // "Should have all their short codes in their hub and frontstore set
      // up" (Stage 4): gives every affiliate a permanent go.avantetravel.co.za
      // short code for their own Hub link, plus one for each hook's "Full
      // Details" page (hook-landing.html) that actually has content worth
      // linking to for THAT affiliate — whether that content comes from
      // the shared admin default or from a hook they've switched to
      // "Manage my own" (see the mode check below, matching hook-api.js's
      // own GET exactly).
      //
      // Deliberately does NOT generate a short code for a hook's live
      // booking link itself: that link is a personalized *snapshot* of
      // whatever the admin default currently has (today's dates, today's
      // promoted property). A pre-baked short code for it would keep
      // resolving to today's snapshot forever, even after the admin
      // rebuilds that hook with new dates or a new property — silently
      // going stale. The Hub link and the Full Details page are both
      // permanent URLs that fetch and personalize their own content live
      // on every visit, so a short code for either never goes stale. An
      // affiliate or admin who wants a short code for a specific live
      // booking link can already build a fresh one anytime via "Shorten
      // this link" (hub.html, or here on a Default Hook card) — built
      // fresh each time, so it's never stale by construction.
      //
      // Idempotent: re-running this after adding a new affiliate, or after
      // a hook gains content it didn't have before, only creates short
      // codes for what's actually new — an affiliate/hook combination that
      // already has a short code pointing at the exact same URL is left
      // alone (see findExistingShortLink) rather than piling up
      // duplicates every time this is run.
      //
      // dryRun (default true unless explicitly false) only reports what
      // would be created — nothing is written.
      const dryRun = body.dryRun !== false;
      const origin = typeof body.origin === "string" ? body.origin.replace(/\/+$/, "") : "";
      if (!origin) return json({ ok: false, error: "missing origin" }, 400, cors);

      const shortLinksStore = getStore({ name: "short-links", consistency: "strong" });

      // hook-landing.html's own renderDetails only ever shows the "Book
      // Now" button — the entire point of that page — when isSafeUrl(data.
      // booking) is true (typeof booking === "string" &&
      // /^https?:\/\//i.test(booking)); it never reads `landing` at all.
      // So "worth a Full Details short code" has to match that exact
      // gate, not hook-api.js's own (broader, different-purpose)
      // hasContent test of booking||landing — a hook with only a Landing
      // page link set (e.g. via "Build landing page link" without ever
      // running "Build booking link") would otherwise get a short code
      // pointing at a page that renders "This offer isn't available right
      // now" forever.
      function hasBookingLink(rec) {
        return !!(rec && typeof rec.booking === "string" && /^https?:\/\//i.test(rec.booking));
      }

      // Read once up front since it's the same 6 admin records for every
      // affiliate.
      const adminHasContent = {};
      for (let n = 1; n <= DEFAULT_HOOK_COUNT; n++) {
        const rec = await hookStore.get("__admin__:" + n, { type: "json" });
        adminHasContent[n] = hasBookingLink(rec);
      }

      const { blobs } = await directoryStore.list();
      const affIds = blobs.map((b) => b.key);

      const results = [];
      let writeErrors = 0;

      async function ensureOne(affId, kind, longUrl) {
        try {
          const existing = await findExistingShortLink(shortLinksStore, affId, longUrl);
          if (existing) {
            results.push({ affId: affId, kind: kind, url: longUrl, shortUrl: existing.shortUrl, created: false });
            return;
          }
          if (dryRun) {
            results.push({ affId: affId, kind: kind, url: longUrl, shortUrl: null, created: true });
            return;
          }
          const made = await createShortLink(shortLinksStore, longUrl, affId);
          if (!made) {
            writeErrors++;
            return;
          }
          results.push({ affId: affId, kind: kind, url: longUrl, shortUrl: made.shortUrl, created: true });
        } catch (e) {
          writeErrors++;
        }
      }

      await mapWithConcurrency(affIds, async (affId) => {
        await ensureOne(affId, "hub", origin + "/hub.html?aff=" + encodeURIComponent(affId));
        for (let n = 1; n <= DEFAULT_HOOK_COUNT; n++) {
          // Same mode/expiry resolution hook-api.js's GET uses (see
          // resolveHookMode): an affiliate who's explicitly switched this
          // hook to "Manage my own" gets their own booking/landing checked
          // instead of the shared admin default — unless their self-managed
          // booking's dates have passed, in which case hook-api.js falls
          // back to the admin default too, same as here. Otherwise a
          // self-managed hook with real content never gets a Full Details
          // short code just because the admin's own default for that slot
          // happens to be empty, an expired self-managed hook doesn't get a
          // short code pointing at content that's no longer actually shown,
          // and (the opposite mistake) an admin default that does have
          // content doesn't wrongly get shortened for someone who's
          // managing that exact hook themselves right now.
          let hasContent;
          try {
            const ownRec = await hookStore.get(affId + ":" + n, { type: "json" });
            const { source } = resolveHookMode(ownRec);
            hasContent = source === "self" ? hasBookingLink(ownRec) : adminHasContent[n];
          } catch (e) {
            // A transient read failure here shouldn't abort the whole bulk
            // run (mapWithConcurrency has no per-item error isolation of
            // its own — a rejection here would reject the entire
            // Promise.all) — record it and move on to the next hook/
            // affiliate, same as ensureOne already does for its own steps.
            writeErrors++;
            continue;
          }
          if (!hasContent) continue;
          await ensureOne(affId, "hook" + n, origin + "/hook-landing.html?aff=" + encodeURIComponent(affId) + "&hook=" + n);
        }
      });

      const createdCount = results.filter((r) => r.created).length;
      const existingCount = results.length - createdCount;

      return json(
        {
          ok: true,
          dryRun: dryRun,
          affiliateCount: affIds.length,
          createdCount: createdCount,
          existingCount: existingCount,
          results: results,
          writeErrors: writeErrors,
        },
        200,
        cors
      );
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
