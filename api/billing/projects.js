import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { cleanText, normalizeProjectInput } from "./_project-billing.js";

function isMissingSetup(error) {
  var message = String(error && error.message || "").toLowerCase();
  return message.indexOf("billing_projects") !== -1 || message.indexOf("create_billing_project") !== -1;
}

function summarize(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(function(acc, row) {
    var amount = Number(row && row.total_amount || 0);
    acc.totalProjects += 1;
    acc.totalValue += amount;
    if (row.status === "draft") { acc.draftCount += 1; acc.unbilledValue += amount; }
    if (row.status === "ready") { acc.readyCount += 1; acc.unbilledValue += amount; }
    if (row.status === "invoiced") { acc.invoicedCount += 1; acc.invoicedValue += amount; }
    return acc;
  }, { totalProjects: 0, draftCount: 0, readyCount: 0, invoicedCount: 0, totalValue: 0, unbilledValue: 0, invoicedValue: 0 });
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "PATCH", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (["GET", "POST", "PATCH"].indexOf(req.method) === -1) return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      var result = await supabase.from("billing_projects")
        .select("*,billing_project_charges(*),billing_invoices(id,invoice_number,status,invoice_date,due_date,subtotal,total,paid_at)")
        .eq("site_id", CACHE_SITE_ID).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(250);
      if (result.error) {
        if (isMissingSetup(result.error)) return res.status(200).json({ rows: [], summary: summarize([]), status: "missing_table" });
        throw result.error;
      }
      var rows = (result.data || []).map(function(row) {
        row.billing_project_charges = (row.billing_project_charges || []).sort(function(a, b) { return Number(a.line_number || 0) - Number(b.line_number || 0); });
        return row;
      });
      return res.status(200).json({ rows: rows, summary: summarize(rows), status: "ready" });
    }

    var body = req.body && typeof req.body === "object" ? req.body : {};
    if (req.method === "POST") {
      var project = normalizeProjectInput(body);
      if (project.errors.length) return res.status(400).json({ error: project.errors.join(" "), errors: project.errors });
      var created = await supabase.rpc("create_billing_project", {
        p_site_id: CACHE_SITE_ID,
        p_customer_name: project.customer,
        p_title: project.title,
        p_occurred_on: project.occurredOn,
        p_purchase_order_number: project.purchaseOrder,
        p_notes: project.notes,
        p_charges: project.charges,
        p_actor: cleanText(user.email, 240)
      });
      if (created.error) throw created.error;
      return res.status(201).json({ ok: true, projectId: created.data, total: project.total });
    }

    var action = cleanText(body.action, 40).toLowerCase();
    var projectId = cleanText(body.projectId, 80);
    if (!projectId) return res.status(400).json({ error: "Project is required." });
    if (action === "create_invoice") {
      var invoice = await supabase.rpc("create_project_invoice", { p_site_id: CACHE_SITE_ID, p_project_id: projectId, p_actor: cleanText(user.email, 240) });
      if (invoice.error) throw invoice.error;
      return res.status(200).json({ ok: true, invoice: invoice.data });
    }
    if (action === "set_status") {
      var status = cleanText(body.status, 20).toLowerCase();
      if (["draft", "ready", "cancelled"].indexOf(status) === -1) return res.status(400).json({ error: "Invalid project status." });
      var updated = await supabase.rpc("set_billing_project_status", { p_site_id: CACHE_SITE_ID, p_project_id: projectId, p_status: status, p_actor: cleanText(user.email, 240) });
      if (updated.error) throw updated.error;
      return res.status(200).json({ ok: true });
    }
    if (action === "mark_paid") {
      var paid = await supabase.rpc("set_billing_invoice_status", { p_site_id: CACHE_SITE_ID, p_project_id: projectId, p_status: "paid", p_actor: cleanText(user.email, 240) });
      if (paid.error) throw paid.error;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Project billing request failed" });
  }
}
