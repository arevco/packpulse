import crypto from "crypto";
import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { addEvent, BUCKET, signedDocumentUrl, text, validateUpload } from "../_service.js";

function missingTable(error) {
  var message = String(error && error.message || "").toLowerCase();
  return message.indexOf("purchase_order_onboarding_documents") !== -1 &&
    (message.indexOf("schema cache") !== -1 || message.indexOf("relation") !== -1);
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var purchaseOrderId = text(req.query && req.query.id, 80);
    var po = await supabase.from("purchase_orders").select("id").eq("site_id", CACHE_SITE_ID).eq("id", purchaseOrderId).single();
    if (po.error) return res.status(404).json({ error: "Purchase order not found" });

    var upload = validateUpload(req.body || {});
    if (upload.contentType !== "application/pdf") {
      return res.status(400).json({ error: "Onboarding documents must be PDF files." });
    }
    var sha256 = crypto.createHash("sha256").update(upload.buffer).digest("hex");
    var existing = await supabase.from("purchase_order_onboarding_documents").select("*")
      .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", purchaseOrderId).eq("sha256", sha256).maybeSingle();
    if (existing.error) {
      if (missingTable(existing.error)) return res.status(409).json({
        error: "Onboarding document storage is not set up yet. Run docs/supabase-purchase-order-onboarding-documents.sql in Supabase."
      });
      throw existing.error;
    }
    if (existing.data) {
      return res.status(200).json({
        duplicate: true,
        document: Object.assign({}, existing.data, { url: await signedDocumentUrl(supabase, existing.data) })
      });
    }

    var storagePath = CACHE_SITE_ID + "/onboarding/" + purchaseOrderId + "/" + sha256 + ".pdf";
    var stored = await supabase.storage.from(BUCKET).upload(storagePath, upload.buffer, {
      contentType: upload.contentType,
      upsert: false
    });
    if (stored.error && String(stored.error.message || "").toLowerCase().indexOf("already exists") === -1) throw stored.error;

    var inserted = await supabase.from("purchase_order_onboarding_documents").insert({
      site_id: CACHE_SITE_ID,
      purchase_order_id: purchaseOrderId,
      original_file_name: upload.fileName,
      content_type: upload.contentType,
      byte_size: upload.buffer.length,
      sha256: sha256,
      storage_path: storagePath,
      uploaded_by: user.email
    }).select("*").single();
    if (inserted.error) throw inserted.error;
    await addEvent(supabase, purchaseOrderId, null, "onboarding_document_uploaded", user, {
      metadata: { documentId: inserted.data.id, fileName: upload.fileName, byteSize: upload.buffer.length }
    });
    return res.status(200).json({
      duplicate: false,
      document: Object.assign({}, inserted.data, { url: await signedDocumentUrl(supabase, inserted.data) })
    });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Onboarding document upload failed" });
  }
}
