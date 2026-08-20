import crypto from "crypto";
import { CACHE_SITE_ID, getSupabaseAdmin } from "../ops/_common.js";
import { ALLOWED_TYPES, BUCKET, date, extractFile, key, signedDocumentUrl, text, validateConfirmed, validateUpload } from "../purchase-orders/_service.js";

export { date, key, signedDocumentUrl, text, validateConfirmed };
export const MAX_QUOTE_FILE_BYTES = 10 * 1024 * 1024;

export function missingQuotesTable(error) {
  var message = String(error && error.message || "").toLowerCase();
  return (message.indexOf("quotes") !== -1 || message.indexOf("quote_") !== -1) &&
    (message.indexOf("schema cache") !== -1 || message.indexOf("relation") !== -1);
}

export async function addQuoteEvent(supabase, quoteId, revisionId, type, user, metadata) {
  var result = await supabase.from("quote_events").insert({
    site_id: CACHE_SITE_ID, quote_id: quoteId, revision_id: revisionId || null,
    event_type: type, actor: user && user.email || "system", metadata: metadata || {}
  });
  if (result.error) throw result.error;
}

export async function stageQuoteUpload(input, user) {
  var supabase = getSupabaseAdmin();
  var stagedStoragePath = text(input && input.storagePath, 500);
  var valid;
  if (stagedStoragePath) {
    var expectedPrefix = CACHE_SITE_ID + "/quotes/staged/";
    if (stagedStoragePath.indexOf(expectedPrefix) !== 0 || stagedStoragePath.indexOf("..") !== -1) {
      throw Object.assign(new Error("Invalid staged quote upload."), { statusCode: 400 });
    }
    var downloaded = await supabase.storage.from(BUCKET).download(stagedStoragePath);
    if (downloaded.error) throw downloaded.error;
    var stagedBuffer = Buffer.from(await downloaded.data.arrayBuffer());
    valid = validateUpload(Object.assign({}, input, { base64: stagedBuffer.toString("base64") }), { maxFileBytes: MAX_QUOTE_FILE_BYTES, maxFileLabel: "10 MB" });
  } else {
    valid = validateUpload(input, { maxFileBytes: MAX_QUOTE_FILE_BYTES, maxFileLabel: "10 MB" });
  }
  var sha256 = crypto.createHash("sha256").update(valid.buffer).digest("hex");
  var existing = await supabase.from("quote_revisions").select("*").eq("site_id", CACHE_SITE_ID).eq("sha256", sha256).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if (stagedStoragePath) await supabase.storage.from(BUCKET).remove([stagedStoragePath]);
    return { duplicate: true, revision: existing.data, extracted: existing.data.extracted_data, documentUrl: await signedDocumentUrl(supabase, existing.data) };
  }
  var storagePath = stagedStoragePath || CACHE_SITE_ID + "/quotes/" + sha256.slice(0, 2) + "/" + sha256 + "." + ALLOWED_TYPES[valid.contentType];
  if (!stagedStoragePath) {
    var stored = await supabase.storage.from(BUCKET).upload(storagePath, valid.buffer, { contentType: valid.contentType, upsert: false });
    if (stored.error && String(stored.error.message || "").toLowerCase().indexOf("already exists") === -1) throw stored.error;
  }
  var extraction;
  try {
    extraction = await extractFile(valid.buffer, valid.contentType, "quote");
  } catch (error) {
    var failed = await supabase.from("quote_revisions").insert({
      site_id: CACHE_SITE_ID, processing_status: "failed", original_file_name: valid.fileName,
      content_type: valid.contentType, byte_size: valid.buffer.length, sha256: sha256,
      storage_path: storagePath, extraction_error: text(error.message, 1000), created_by: user.email
    }).select("*").single();
    if (failed.error) throw failed.error;
    return { duplicate: false, revision: failed.data, error: failed.data.extraction_error, documentUrl: await signedDocumentUrl(supabase, failed.data) };
  }
  var inserted = await supabase.from("quote_revisions").insert({
    site_id: CACHE_SITE_ID, processing_status: "needs_review", original_file_name: valid.fileName,
    content_type: valid.contentType, byte_size: valid.buffer.length, sha256: sha256,
    storage_path: storagePath, extracted_data: extraction.data, warnings: extraction.data.warnings,
    extraction_model: extraction.model, created_by: user.email
  }).select("*").single();
  if (inserted.error) throw inserted.error;
  return { duplicate: false, revision: inserted.data, extracted: extraction.data, documentUrl: await signedDocumentUrl(supabase, inserted.data) };
}
