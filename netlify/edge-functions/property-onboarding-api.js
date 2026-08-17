import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

// Backs the "Property Affiliate" onboarding tab in hub.html, and the
// "Property Listings" tab in admin.html. A property owner (or an existing
// travel affiliate acting as their mandated agent) submits a listing here;
// it's stored with status "Requested" for Avante to review. Admin can then
// change the status to "Listed" (approved, live) or "Rejected". Nothing
// here auto-publishes a listing anywhere else â it only records/tracks it.

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 500) : "";
}

function escapeHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function genListingId() {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return "P-" + n;
}

const STATUSES = ["Requested", "Listed", "Rejected"];

function sanitizeUnitTypes(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 30).map((u) => ({
    name: clean(u && u.name, 200),
    maxOccupancy: clean(u && u.maxOccupancy, 10),
    maxAdults: clean(u && u.maxAdults, 10),
    childrenAllowed: clean(u && u.childrenAllowed, 5),
    numUnits: clean(u && u.numUnits, 10),
    rateScheme: clean(u && u.rateScheme, 30),
    rateBasis: clean(u && u.rateBasis, 30),
    seasonStart: clean(u && u.seasonStart, 20),
    seasonEnd: clean(u && u.seasonEnd, 20),
    ratePax1: clean(u && u.ratePax1, 20),
    ratePax2: clean(u && u.ratePax2, 20),
    ratePax3: clean(u && u.ratePax3, 20),
    ratePax4: clean(u && u.ratePax4, 20),
    ratePax5: clean(u && u.ratePax5, 20),
    childRate06: clean(u && u.childRate06, 20),
    childRate712: clean(u && u.childRate712, 20),
    description: clean(u && u.description, 2000),
  }));
}

function sanitizeAmenities(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 400).map((a) => ({
    category: clean(a && a.category, 100),
    item: clean(a && a.item, 150),
    available: (a && a.available) === "Y" ? "Y" : "N",
    notes: clean(a && a.notes, 300),
  }));
}

function sanitizeFileRefs(input, max) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, max || 60).map((f) => ({
    type: clean(f && f.type, 100),
    unitTypeName: clean(f && f.unitTypeName, 200),
    key: clean(f && f.key, 300),
    fileName: clean(f && f.fileName, 200),
    caption: clean(f && f.caption, 300),
    cover: (f && f.cover) === "Y" ? "Y" : "N",
  }));
}

async function verifyAdminToken(token) {
  if (!token) return false;
  const sessionStore = getStore({ name: "admin-sessions", consistency: "strong" });
  const session = await sessionStore.get(token, { type: "json" });
  if (!session) return false;
  if (new Date(session.expiresAt).getTime() < Date.now()) return false;
  return true;
}

async function sendNotificationEmail(to, subject, html) {
  try {
    const apiKey = Netlify.env.get("RESEND_API_KEY");
    if (!apiKey || !to) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: "Bearer " + apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: "Avante Travel <onboarding@resend.dev>",
        to: [to],
        subject: subject,
        html: html,
      }),
    });
  } catch (e) {
    // Email failures should never break the listing submit/status flow.
  }
}

async function getNotificationEmail() {
  const settingsStore = getStore({ name: "property-settings", consistency: "strong" });
  const settings = await settingsStore.get("config", { type: "json" });
  return (settings && settings.notificationEmail) || "";
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

  const action = body.action;
  const store = getStore({ name: "property-listings", consistency: "strong" });

  const json = (data, status) =>
    new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { "content-type": "application/json", ...cors },
    });

  const requireAdmin = async () => {
    const authed = await verifyAdminToken(body.token);
    if (!authed) return json({ error: "Not authenticated." }, 401);
    return null;
  };

  try {
    if (action === "submit") {
      const listingId = genListingId();
      const now = new Date().toISOString();

      const record = {
        listingId: listingId,
        status: "Requested",
        dateSubmitted: now,
        dateUpdated: now,

        propertyName: clean(body.propertyName, 200),
        propertyName2: clean(body.propertyName2, 200),
        country: clean(body.country, 100),
        suburb: clean(body.suburb, 100),
        city: clean(body.city, 100),
        city2: clean(body.city2, 100),
        stateProvince: clean(body.stateProvince, 100),
        area: clean(body.area, 100),
        district: clean(body.district, 100),
        propertyType: clean(body.propertyType, 100),
        complexName: clean(body.complexName, 200),
        infoLink: clean(body.infoLink, 300),
        bookingLink: clean(body.bookingLink, 300),
        siteNr: "",
        telephone: clean(body.telephone, 60),
        email: clean(body.email, 200),
        latitude: clean(body.latitude, 30),
        longitude: clean(body.longitude, 30),
        selfSupplierRating: clean(body.selfSupplierRating, 50),
        tourismBoardGrading: clean(body.tourismBoardGrading, 50),
        ratingLink: clean(body.ratingLink, 300),

        ownerFullName: clean(body.ownerFullName, 200),
        ownerIdPassport: clean(body.ownerIdPassport, 60),
        ownerEmail: clean(body.ownerEmail, 200),
        ownerPhone: clean(body.ownerPhone, 60),

        submittedBy: body.submittedBy === "Affiliate" ? "Affiliate" : "Owner",
        affId: clean(body.affId, 100),
        affiliateAgentName: clean(body.affiliateAgentName, 200),
        affiliateCompany: clean(body.affiliateCompany, 200),
        affiliateEmail: clean(body.affiliateEmail, 200),
        affiliatePhone: clean(body.affiliatePhone, 60),

        checkInTime: clean(body.checkInTime, 20),
        checkOutTime: clean(body.checkOutTime, 20),
        description: clean(body.description, 4000),
        houseRules: clean(body.houseRules, 4000),
        moreInfo: clean(body.moreInfo, 4000),
        areaInfo: clean(body.areaInfo, 4000),

        depositPolicyText: clean(body.depositPolicyText, 2000),
        depositPct: clean(body.depositPct, 10),
        depositDays: clean(body.depositDays, 10),
        childPolicy: clean(body.childPolicy, 1000),
        paymentGatewayInUse: body.paymentGatewayInUse === "Y" ? "Y" : "N",
        allowSameDayBooking: body.allowSameDayBooking === "Y" ? "Y" : "N",

        unitTypes: sanitizeUnitTypes(body.unitTypes),
        amenities: sanitizeAmenities(body.amenities),
        documents: sanitizeFileRefs(body.documents, 20),
        images: sanitizeFileRefs(body.images, 60),

        agreementSigned: body.agreementSigned === true ? "Y" : "N",
        signatoryName: clean(body.signatoryName, 200),
        signatoryCapacity: clean(body.signatoryCapacity, 100),
        signatoryIdPassport: clean(body.signatoryIdPassport, 60),
        signatureDate: clean(body.signatureDate, 20),
        signaturePlace: clean(body.signaturePlace, 200),
      };

      if (!record.propertyName || !record.ownerFullName || record.agreementSigned !== "Y") {
        return json(
          { error: "Property name, owner name, and agreement acceptance are required." },
          400
        );
      }

      await store.setJSON(listingId, record);

      const notifyTo = await getNotificationEmail();
      if (notifyTo) {
        context.waitUntil(
          sendNotificationEmail(
            notifyTo,
            "New property listing submitted â " + record.propertyName,
            "<p>A new property listing was submitted for review.</p>" +
              "<p><strong>Listing ID:</strong> " + escapeHtml(listingId) + "<br>" +
              "<strong>Property:</strong> " + escapeHtml(record.propertyName) + "<br>" +
              "<strong>Submitted by:</strong> " + escapeHtml(record.submittedBy) + " â " + escapeHtml(record.ownerFullName) + "<br>" +
              "<strong>Status:</strong> Requested</p>" +
              "<p>Log in to Admin &gt; Property Listings to review and approve.</p>"
          )
        );
      }

      return json({ ok: true, listingId: listingId });
    }

    if (action === "get") {
      const denied = await requireAdmin();
      if (denied) return denied;

      const listingId = clean(body.listingId, 20);
      if (!listingId) return json({ error: "missing listingId" }, 400);
      const record = await store.get(listingId, { type: "json" });
      if (!record) return json({ error: "not found" }, 404);
      return json({ ok: true, listing: record });
    }

    if (action === "list") {
      const denied = await requireAdmin();
      if (denied) return denied;

      const { blobs } = await store.list();
      const items = await Promise.all(
        blobs.map((b) => store.get(b.key, { type: "json" }))
      );
      const summaries = items
        .filter(Boolean)
        .map((r) => ({
          listingId: r.listingId,
          propertyName: r.propertyName,
          ownerFullName: r.ownerFullName,
          submittedBy: r.submittedBy,
          country: r.country,
          city: r.city,
          status: r.status || "Requested",
          siteNr: r.siteNr || "",
          dateSubmitted: r.dateSubmitted,
          dateUpdated: r.dateUpdated,
        }))
        .sort((a, b) => new Date(b.dateSubmitted) - new Date(a.dateSubmitted));

      return json({ ok: true, listings: summaries });
    }

    if (action === "updateStatus") {
      const denied = await requireAdmin();
      if (denied) return denied;

      const listingId = clean(body.listingId, 20);
      const status = clean(body.status, 30);
      const siteNr = typeof body.siteNr === "string" ? clean(body.siteNr, 30) : undefined;

      if (!listingId || STATUSES.indexOf(status) === -1) {
        return json({ error: "Valid listingId and status are required." }, 400);
      }

      const record = await store.get(listingId, { type: "json" });
      if (!record) return json({ error: "not found" }, 404);

      const prevStatus = record.status;
      record.status = status;
      record.dateUpdated = new Date().toISOString();
      if (siteNr !== undefined) record.siteNr = siteNr;

      await store.setJSON(listingId, record);

      if (prevStatus !== status) {
        const submitterEmail =
          record.submittedBy === "Affiliate" ? record.affiliateEmail : record.ownerEmail;
        if (submitterEmail) {
          context.waitUntil(
            sendNotificationEmail(
              submitterEmail,
              "Your Avante property listing status has changed â " + status,
              "<p>Hi " + escapeHtml(record.ownerFullName || "") + ",</p>" +
                "<p>Your property listing <strong>" + escapeHtml(record.propertyName) + "</strong> (" +
                escapeHtml(listingId) + ") status is now: <strong>" + escapeHtml(status) + "</strong>.</p>" +
                (status === "Listed"
                  ? "<p>Your property is now live in Avante's Private Property STR Database.</p>"
                  : "") +
                "<p>Questions? Reply to this email or contact Avante Travel directly.</p>"
            )
          );
        }
      }

      return json({ ok: true, listing: record });
    }

    if (action === "getSettings") {
      const denied = await requireAdmin();
      if (denied) return denied;

      const settingsStore = getStore({ name: "property-settings", consistency: "strong" });
      const settings = await settingsStore.get("config", { type: "json" });
      return json({ ok: true, settings: settings || { notificationEmail: "" } });
    }

    if (action === "setSettings") {
      const denied = await requireAdmin();
      if (denied) return denied;

      const notificationEmail = clean(body.notificationEmail, 200);
      const settingsStore = getStore({ name: "property-settings", consistency: "strong" });
      await settingsStore.setJSON("config", { notificationEmail: notificationEmail });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
};

export const config = { path: "/api/property-onboarding" };
