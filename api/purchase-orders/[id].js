import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { addEvent, signedDocumentUrl, text } from "./_service.js";

function missingOnboardingDocumentsTable(error) {
  var message = String(error && error.message || "").toLowerCase();
  return message.indexOf("purchase_order_onboarding_documents") !== -1 &&
    (message.indexOf("schema cache") !== -1 || message.indexOf("relation") !== -1);
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "PATCH", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var id = text(req.query && req.query.id, 80);
    var found = await supabase.from("purchase_orders").select("*").eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (found.error) return res.status(found.error.code === "PGRST116" ? 404 : 500).json({ error: found.error.message });
    if (req.method === "PATCH") {
      var requestedStatus = text(req.body && req.body.status, 40).toLowerCase();
      var update = { updated_by: user.email };
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, "notes")) update.notes = text(req.body.notes, 4000) || null;
      if (requestedStatus) {
        if (["open","closed","cancelled"].indexOf(requestedStatus) === -1) return res.status(400).json({ error: "Invalid status" });
        update.status = requestedStatus;
      }
      var changed = await supabase.from("purchase_orders").update(update).eq("site_id", CACHE_SITE_ID).eq("id", id).select("*").single();
      if (changed.error) throw changed.error;
      await addEvent(supabase, id, found.data.current_revision_id, requestedStatus ? "status_changed" : "metadata_updated", user, {
        fromStatus: found.data.status, toStatus: changed.data.status, note: req.body && req.body.note
      });
      found.data = changed.data;
    }
    var related = await Promise.all([
      supabase.from("purchase_order_lines").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).eq("revision_id", found.data.current_revision_id).order("line_number"),
      supabase.from("purchase_order_revisions").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).order("revision_number", { ascending: false }),
      supabase.from("purchase_order_events").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).order("created_at", { ascending: false }),
      supabase.from("purchase_order_onboarding_documents").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).order("created_at", { ascending: false })
    ]);
    related.slice(0, 3).forEach(function(result) { if (result.error) throw result.error; });
    if (related[3].error && !missingOnboardingDocumentsTable(related[3].error)) throw related[3].error;
    var currentRevision = (related[1].data || []).find(function(row) { return row.id === found.data.current_revision_id; });
    var documentUrl = await signedDocumentUrl(supabase, currentRevision);
    var onboardingDocuments = [];
    if (!related[3].error) {
      onboardingDocuments = await Promise.all((related[3].data || []).map(async function(row) {
        return Object.assign({}, row, { url: await signedDocumentUrl(supabase, row) });
      }));
    }
    return res.status(200).json({
      purchaseOrder: found.data, lines: related[0].data || [], revisions: related[1].data || [],
      events: related[2].data || [], documentUrl: documentUrl,
      onboardingDocuments: onboardingDocuments,
      onboardingDocumentsStatus: related[3].error ? "missing_table" : "ready"
    });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Purchase order request failed" });
  }
}
