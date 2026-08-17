import { getStore } from "https://esm.sh/@netlify/blobs@8?bundle";

// Backs the "Property Affiliate" onboarding tab in hub.html. A property
// owner (or an existing travel affiliate acting as their mandated agent)
// submits a listing here; it's stored as "Pending Verification" for Avante
// to review and load into the Private Property STR Database. This never
// auto-publishes a listing — it only records the submission.

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max || 500) : "";
}

function genListingId() {
  const n = Math.floor(Math.random() * 900000) + 100000;
  return "P-" + n;
}

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

  try {
    if (action === "submit") {
      const listingId = genListingId();
      const now = new Date().toISOString();

      const record = {
        listingId: listingId,
        status: "Pending Verification",
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
        siteNr: clean(body.siteNr, 30),
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
        return new Response(
          JSON.stringify({ error: "Property name, owner name, and agreement acceptance are required." }),
          { status: 400, headers: { "content-type": "application/json", ...cors } }
        );
      }

      await store.setJSON(listingId, record);

      return new Response(JSON.stringify({ ok: true, listingId: listingId }), {
        headers: { "content-type": "application/json", ...cors },
      });
    }

    if (action === "get") {
      const listingId = clean(body.listingId, 20);
      if (!listingId) {
        return new Response(JSON.stringify({ error: "missing listingId" }), {
          status: 400,
          headers: { "content-type": "application/json", ...cors },
        });
      }
      const record = await store.get(listingId, { type: "json" });
      if (!record) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json", ...cors },
        });
      }
      return new Response(JSON.stringify({ ok: true, listing: record }), {
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

export const config = { path: "/api/property-onboarding" };
