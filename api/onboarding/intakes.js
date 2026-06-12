import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";

var STATUS_KEYS = { draft: true, submitted: true };
var SELECT_FIELDS = [
  "id",
  "site_id",
  "status",
  "customer_name",
  "primary_contact_name",
  "primary_contact_email",
  "target_production_date",
  "intake_data",
  "archived",
  "created_by",
  "created_at",
  "updated_by",
  "updated_at",
  "submitted_at"
].join(",");

function sanitizeText(v, maxLen) {
  var s = String(v || "").trim();
  if (!s) return "";
  return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeId(v) {
  var s = String(v || "").trim();
  return s && s.length <= 80 ? s : "";
}

function sanitizeStatus(v) {
  var key = String(v || "").trim().toLowerCase();
  return STATUS_KEYS[key] ? key : "draft";
}

function sanitizeDate(v) {
  var s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value && typeof value === "object" ? value : {}));
  } catch (_error) {
    return {};
  }
}

function pickPrimaryContact(intakeData) {
  var contacts = intakeData && Array.isArray(intakeData.contacts) ? intakeData.contacts : [];
  for (var i = 0; i < contacts.length; i++) {
    var row = contacts[i] || {};
    var fullName = sanitizeText(row.fullName, 160);
    var email = sanitizeText(row.email, 160);
    if (fullName || email) {
      return {
        fullName: fullName,
        email: email
      };
    }
  }
  return { fullName: "", email: "" };
}

function createIntakePayload(input, user) {
  var intakeData = cloneJson(input.intake_data || input.intakeData || {});
  var primaryContact = pickPrimaryContact(intakeData);
  var targetProductionDate = sanitizeDate(
    input.target_production_date ||
    (intakeData && intakeData.launch ? intakeData.launch.targetProductionDate : "")
  );
  return {
    site_id: CACHE_SITE_ID,
    status: sanitizeStatus(input.status),
    customer_name: sanitizeText(
      input.customer_name ||
      (intakeData && intakeData.companyLegalName ? intakeData.companyLegalName : ""),
      160
    ) || null,
    primary_contact_name: primaryContact.fullName || null,
    primary_contact_email: primaryContact.email || null,
    target_production_date: targetProductionDate,
    intake_data: intakeData,
    archived: false,
    updated_by: user && user.email ? user.email : "system",
    updated_at: new Date().toISOString()
  };
}

function isMissingTableError(err) {
  var msg = String((err && (err.message || err.details || err.hint)) || "").toLowerCase();
  return msg.indexOf("customer_onboarding_intakes") !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      var query = supabase
        .from("customer_onboarding_intakes")
        .select(SELECT_FIELDS)
        .eq("site_id", CACHE_SITE_ID)
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      var intakeId = sanitizeId(req.query && req.query.id);
      if (intakeId) query = query.eq("id", intakeId).limit(1);
      var result = await query;
      if (result.error) {
        if (isMissingTableError(result.error)) {
          return res.status(200).json({
            rows: [],
            status: "missing_customer_onboarding_table",
            message: "Customer onboarding intake table is not set up yet."
          });
        }
        throw result.error;
      }
      var rows = Array.isArray(result.data) ? result.data : [];
      return res.status(200).json({ rows: rows });
    }

    var body = req.body || {};
    var action = sanitizeText(body.action, 32).toLowerCase();
    if (action !== "upsert_intake") return res.status(400).json({ error: "Unsupported action" });

    var intake = body.intake && typeof body.intake === "object" ? body.intake : {};
    var intakeId = sanitizeId(intake.id);
    var payload = createIntakePayload(intake, user);
    if (payload.status === "submitted" && !payload.customer_name) {
      return res.status(400).json({ error: "Company legal name is required before submission." });
    }

    var resultUpsert;
    if (intakeId) {
      payload.submitted_at = payload.status === "submitted" ? new Date().toISOString() : null;
      resultUpsert = await supabase
        .from("customer_onboarding_intakes")
        .update(payload)
        .eq("site_id", CACHE_SITE_ID)
        .eq("id", intakeId)
        .select(SELECT_FIELDS)
        .single();
    } else {
      payload.created_by = user && user.email ? user.email : "system";
      payload.created_at = new Date().toISOString();
      payload.submitted_at = payload.status === "submitted" ? new Date().toISOString() : null;
      resultUpsert = await supabase
        .from("customer_onboarding_intakes")
        .insert(payload)
        .select(SELECT_FIELDS)
        .single();
    }

    if (resultUpsert.error) {
      if (isMissingTableError(resultUpsert.error)) {
        return res.status(200).json({
          ok: false,
          status: "missing_customer_onboarding_table",
          message: "Customer onboarding intake table is not set up yet."
        });
      }
      throw resultUpsert.error;
    }

    return res.status(200).json({ ok: true, row: resultUpsert.data });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error && error.message ? error.message : "Unexpected server error" });
  }
}
