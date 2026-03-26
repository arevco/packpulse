import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";

var BOARD_KEYS = { recurring: true, onboarding: true, projects: true };
var STATUS_KEYS = { todo: true, working: true, waiting: true, done: true };
var PRIORITY_KEYS = { low: true, medium: true, high: true };
var CADENCE_KEYS = { adhoc: true, daily: true, weekly: true, monthly: true, onboarding: true };
var SELECT_FIELDS = [
  "id",
  "site_id",
  "board_key",
  "title",
  "status",
  "priority",
  "cadence",
  "owner_email",
  "due_date",
  "customer_name",
  "project_name",
  "notes",
  "sort_order",
  "archived",
  "created_by",
  "created_at",
  "updated_by",
  "updated_at",
  "completed_at"
].join(",");

function sanitizeText(v, maxLen) {
  var s = String(v || "").trim();
  if (!s) return "";
  return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sanitizeEnum(v, allowed, fallback) {
  var key = String(v || "").trim().toLowerCase();
  return allowed[key] ? key : fallback;
}

function sanitizeBoardKey(v, fallback) {
  return sanitizeEnum(v, BOARD_KEYS, fallback || "recurring");
}

function sanitizeStatus(v) {
  return sanitizeEnum(v, STATUS_KEYS, "todo");
}

function sanitizePriority(v) {
  return sanitizeEnum(v, PRIORITY_KEYS, "medium");
}

function sanitizeCadence(v, boardKey) {
  var fallback = boardKey === "recurring" ? "weekly" : boardKey === "onboarding" ? "onboarding" : "adhoc";
  return sanitizeEnum(v, CADENCE_KEYS, fallback);
}

function sanitizeDate(v) {
  var s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function sanitizeId(v) {
  var s = String(v || "").trim();
  return s && s.length <= 80 ? s : "";
}

function sanitizeSortOrder(v) {
  var n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : Date.now();
}

function isMissingTableError(err) {
  var msg = String((err && (err.message || err.details || err.hint)) || "").toLowerCase();
  return msg.indexOf("team_board_tasks") !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
}

function createTaskPayload(input) {
  var boardKey = sanitizeBoardKey(input.board_key || input.boardKey, "recurring");
  return {
    board_key: boardKey,
    title: sanitizeText(input.title, 160),
    status: sanitizeStatus(input.status),
    priority: sanitizePriority(input.priority),
    cadence: sanitizeCadence(input.cadence, boardKey),
    owner_email: sanitizeText(input.owner_email || input.ownerEmail, 160) || null,
    due_date: sanitizeDate(input.due_date || input.dueDate),
    customer_name: sanitizeText(input.customer_name || input.customerName, 160) || null,
    project_name: sanitizeText(input.project_name || input.projectName, 160) || null,
    notes: sanitizeText(input.notes, 4000) || null,
    sort_order: sanitizeSortOrder(input.sort_order || input.sortOrder),
    archived: !!input.archived
  };
}

function createSeedRows(user) {
  var now = new Date().toISOString();
  var createdBy = user && user.email ? user.email : "system";
  var withMeta = function(values, sortOrder) {
    return Object.assign({
      site_id: CACHE_SITE_ID,
      created_by: createdBy,
      created_at: now,
      updated_by: createdBy,
      updated_at: now,
      sort_order: sortOrder
    }, values);
  };
  return [
    withMeta({ board_key: "recurring", title: "Morning production sync check", status: "todo", priority: "high", cadence: "daily", notes: "Confirm overnight sync health, production snapshot freshness, and any failed data feeds." }, 100),
    withMeta({ board_key: "recurring", title: "Inventory exceptions review", status: "todo", priority: "medium", cadence: "daily", notes: "Scan short-dated lots, missing locations, and any inventory rows that still look incomplete." }, 200),
    withMeta({ board_key: "recurring", title: "Customer priority review", status: "todo", priority: "medium", cadence: "weekly", notes: "Review late or at-risk work orders for top customers and update owners." }, 300),
    withMeta({ board_key: "recurring", title: "Supply risk review", status: "todo", priority: "medium", cadence: "weekly", notes: "Review shortages, substitutions, and inbound coverage before the next weekly planning cycle." }, 400),
    withMeta({ board_key: "recurring", title: "Forecast publish", status: "todo", priority: "high", cadence: "monthly", notes: "Publish the current month forecast version after assumption review." }, 500),
    withMeta({ board_key: "recurring", title: "Ops rates review", status: "todo", priority: "medium", cadence: "monthly", notes: "Check labor rates, assumptions, and any structural changes that affect margins." }, 600),
    withMeta({ board_key: "onboarding", title: "Kickoff call and success criteria", status: "todo", priority: "high", cadence: "onboarding", notes: "Confirm scope, owners, timeline, and first success checkpoint." }, 700),
    withMeta({ board_key: "onboarding", title: "Collect item master, BOM, and work order exports", status: "todo", priority: "high", cadence: "onboarding", notes: "Request source files and confirm the latest pull cadence with the customer." }, 800),
    withMeta({ board_key: "onboarding", title: "Validate mappings and naming conventions", status: "todo", priority: "medium", cadence: "onboarding", notes: "Check SKU naming, customer labels, and line naming before the first dashboard review." }, 900),
    withMeta({ board_key: "onboarding", title: "Run first forecast and operations baseline", status: "todo", priority: "medium", cadence: "onboarding", notes: "Generate the first baseline and review assumptions with the customer." }, 1000),
    withMeta({ board_key: "projects", title: "Nulogy API backlog grooming", status: "todo", priority: "medium", cadence: "adhoc", project_name: "Nulogy API", notes: "Track report gaps, merge opportunities, and new feature requests from the artifact review." }, 1100),
    withMeta({ board_key: "projects", title: "Dashboard polish queue", status: "todo", priority: "low", cadence: "adhoc", project_name: "PackPulse UI", notes: "Keep lightweight UI improvements visible without burying them in ad hoc chat." }, 1200)
  ];
}

function summarizeRows(rows) {
  var summary = {
    total: 0,
    byBoard: { recurring: 0, onboarding: 0, projects: 0 },
    byStatus: { todo: 0, working: 0, waiting: 0, done: 0 }
  };
  (rows || []).forEach(function(row) {
    summary.total += 1;
    if (summary.byBoard[row.board_key] != null) summary.byBoard[row.board_key] += 1;
    if (summary.byStatus[row.status] != null) summary.byStatus[row.status] += 1;
  });
  return summary;
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
      var boardKey = sanitizeText(req.query && req.query.boardKey, 32);
      var includeArchived = String((req.query && req.query.includeArchived) || "") === "1";
      var query = supabase
        .from("team_board_tasks")
        .select(SELECT_FIELDS)
        .eq("site_id", CACHE_SITE_ID)
        .order("board_key", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false });
      if (BOARD_KEYS[boardKey]) query = query.eq("board_key", boardKey);
      if (!includeArchived) query = query.eq("archived", false);
      var result = await query;
      if (result.error) {
        if (isMissingTableError(result.error)) {
          return res.status(200).json({
            rows: [],
            summary: summarizeRows([]),
            status: "missing_team_board_table",
            message: "Team board table is not set up yet."
          });
        }
        throw result.error;
      }
      var rows = Array.isArray(result.data) ? result.data : [];
      return res.status(200).json({ rows: rows, summary: summarizeRows(rows) });
    }

    var body = req.body || {};
    var action = sanitizeText(body.action, 32).toLowerCase();

    if (action === "seed_defaults") {
      var existing = await supabase
        .from("team_board_tasks")
        .select("id", { count: "exact", head: true })
        .eq("site_id", CACHE_SITE_ID)
        .eq("archived", false);
      if (existing.error) {
        if (isMissingTableError(existing.error)) {
          return res.status(200).json({
            ok: false,
            status: "missing_team_board_table",
            message: "Team board table is not set up yet."
          });
        }
        throw existing.error;
      }
      if (Number(existing.count || 0) > 0) {
        return res.status(200).json({ ok: true, seeded: 0, status: "already_seeded", rows: [] });
      }
      var seedInsert = await supabase
        .from("team_board_tasks")
        .insert(createSeedRows(user))
        .select(SELECT_FIELDS);
      if (seedInsert.error) {
        if (isMissingTableError(seedInsert.error)) {
          return res.status(200).json({
            ok: false,
            status: "missing_team_board_table",
            message: "Team board table is not set up yet."
          });
        }
        throw seedInsert.error;
      }
      return res.status(200).json({ ok: true, seeded: Array.isArray(seedInsert.data) ? seedInsert.data.length : 0, rows: seedInsert.data || [] });
    }

    if (action === "archive_task") {
      var archiveId = sanitizeId(body.id);
      if (!archiveId) return res.status(400).json({ error: "Missing task id" });
      var archiveResult = await supabase
        .from("team_board_tasks")
        .update({
          archived: true,
          updated_by: user.email || "system",
          updated_at: new Date().toISOString()
        })
        .eq("site_id", CACHE_SITE_ID)
        .eq("id", archiveId)
        .select(SELECT_FIELDS)
        .single();
      if (archiveResult.error) {
        if (isMissingTableError(archiveResult.error)) {
          return res.status(200).json({
            ok: false,
            status: "missing_team_board_table",
            message: "Team board table is not set up yet."
          });
        }
        throw archiveResult.error;
      }
      return res.status(200).json({ ok: true, row: archiveResult.data });
    }

    if (action === "upsert_task") {
      var task = body.task && typeof body.task === "object" ? body.task : {};
      var taskId = sanitizeId(task.id);
      var payload = createTaskPayload(task);
      if (!payload.title) return res.status(400).json({ error: "Task title is required" });
      var now = new Date().toISOString();
      payload.site_id = CACHE_SITE_ID;
      payload.updated_by = user.email || "system";
      payload.updated_at = now;
      payload.completed_at = payload.status === "done" ? now : null;

      var resultUpsert;
      if (taskId) {
        resultUpsert = await supabase
          .from("team_board_tasks")
          .update(payload)
          .eq("site_id", CACHE_SITE_ID)
          .eq("id", taskId)
          .select(SELECT_FIELDS)
          .single();
      } else {
        payload.created_by = user.email || "system";
        payload.created_at = now;
        resultUpsert = await supabase
          .from("team_board_tasks")
          .insert(payload)
          .select(SELECT_FIELDS)
          .single();
      }
      if (resultUpsert.error) {
        if (isMissingTableError(resultUpsert.error)) {
          return res.status(200).json({
            ok: false,
            status: "missing_team_board_table",
            message: "Team board table is not set up yet."
          });
        }
        throw resultUpsert.error;
      }
      return res.status(200).json({ ok: true, row: resultUpsert.data });
    }

    return res.status(400).json({ error: "Unsupported action" });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Team board request failed", details: err && err.message ? err.message : "unknown" });
  }
}
