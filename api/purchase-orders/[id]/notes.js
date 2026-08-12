import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { addEvent, text } from "../_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var id = text(req.query && req.query.id, 80);
    var note = text(req.body && req.body.note, 2000);
    if (!note) return res.status(400).json({ error: "Enter a note before posting." });
    var supabase = getSupabaseAdmin();
    var found = await supabase.from("purchase_orders").select("id,current_revision_id")
      .eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (found.error) return res.status(found.error.code === "PGRST116" ? 404 : 500).json({ error: found.error.message });
    await addEvent(supabase, id, found.data.current_revision_id, "po_note_added", user, { note: note });
    var created = await supabase.from("purchase_order_events").select("*")
      .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).eq("event_type", "po_note_added")
      .order("created_at", { ascending: false }).limit(1).single();
    if (created.error) throw created.error;
    return res.status(201).json({ note: created.data });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Could not post note." });
  }
}
