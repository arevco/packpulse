import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TabsNav from "../components/ui/tabs-nav";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";

var BOARD_ITEMS = [
  { key: "recurring", label: "Recurring" },
  { key: "onboarding", label: "Onboarding" },
  { key: "projects", label: "Projects" }
];

var STATUS_COLUMNS = [
  { key: "todo", label: "To Do" },
  { key: "working", label: "Working" },
  { key: "waiting", label: "Waiting" },
  { key: "done", label: "Done" }
];

var CADENCE_FILTERS = [
  { key: "all", label: "All" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "adhoc", label: "Ad hoc" }
];

function createBlankTask(boardKey) {
  var normalizedBoardKey = boardKey === "onboarding" || boardKey === "projects" ? boardKey : "recurring";
  return {
    id: "",
    board_key: normalizedBoardKey,
    title: "",
    status: "todo",
    priority: "medium",
    cadence: normalizedBoardKey === "recurring" ? "weekly" : normalizedBoardKey === "onboarding" ? "onboarding" : "adhoc",
    owner_email: "",
    due_date: "",
    customer_name: "",
    project_name: "",
    notes: "",
    sort_order: Date.now()
  };
}

function createDraftTask(boardKey, ownerEmail) {
  var task = createBlankTask(boardKey);
  if (ownerEmail) task.owner_email = ownerEmail;
  return task;
}

function sortRows(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort(function(a, b) {
    var boardCompare = String(a.board_key || "").localeCompare(String(b.board_key || ""));
    if (boardCompare) return boardCompare;
    var sortCompare = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (sortCompare) return sortCompare;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
}

var TEAM_BOARD_QUERY_KEY = ["team-board"];
var TEAM_BOARD_STALE_MS = 5 * 60 * 1000;

async function fetchTeamBoard() {
  var res = await fetch("/api/team/board", { credentials: "include" });
  var body = await res.json();
  if (!res.ok) throw new Error(body && body.error ? body.error : "Could not load team board");
  return {
    rows: sortRows(body && Array.isArray(body.rows) ? body.rows : []),
    status: String((body && body.status) || "")
  };
}

function statusVariant(status) {
  if (status === "done") return "success";
  if (status === "working") return "info";
  if (status === "waiting") return "warning";
  return "secondary";
}

function priorityVariant(priority) {
  if (priority === "high") return "danger";
  if (priority === "low") return "secondary";
  return "default";
}

function formatDateLabel(value) {
  if (!value) return "";
  var d = new Date(value + "T00:00:00");
  if (isNaN(d)) return String(value);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function nextStatus(status) {
  if (status === "todo") return "working";
  if (status === "working") return "waiting";
  if (status === "waiting") return "done";
  return "todo";
}

function nextStatusLabel(status) {
  if (status === "todo") return "Start";
  if (status === "working") return "Mark Waiting";
  if (status === "waiting") return "Mark Done";
  return "Reopen";
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function rowMatchesSearch(row, query) {
  if (!query) return true;
  var haystack = [
    row.title,
    row.owner_email,
    row.customer_name,
    row.project_name,
    row.notes
  ].join(" ").toLowerCase();
  return haystack.indexOf(query) !== -1;
}

function isOverdue(row) {
  if (!row || !row.due_date || row.status === "done") return false;
  var today = new Date();
  var current = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  var due = new Date(String(row.due_date) + "T00:00:00").getTime();
  return Number.isFinite(due) && due < current;
}

function isDueSoon(row) {
  if (!row || !row.due_date || row.status === "done") return false;
  var today = new Date();
  var current = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  var due = new Date(String(row.due_date) + "T00:00:00").getTime();
  if (!Number.isFinite(due)) return false;
  var diffDays = Math.round((due - current) / 86400000);
  return diffDays >= 0 && diffDays <= 3;
}

function dueBadge(row) {
  if (isOverdue(row)) return { label: "Overdue", variant: "danger" };
  if (isDueSoon(row)) return { label: "Due Soon", variant: "warning" };
  if (row && row.due_date) return { label: "Due " + formatDateLabel(row.due_date), variant: "secondary" };
  return null;
}

export default function TeamBoardView() {
  var queryClient = useQueryClient();
  var [boardKey, setBoardKey] = useState("recurring");
  var [cadenceFilter, setCadenceFilter] = useState("all");
  var [searchQuery, setSearchQuery] = useState("");
  var [showOnlyMine, setShowOnlyMine] = useState(false);
  var [showOnlyUrgent, setShowOnlyUrgent] = useState(false);
  var [currentUserEmail, setCurrentUserEmail] = useState("");
  var [saving, setSaving] = useState(false);
  var [error, setError] = useState("");
  var [statusMessage, setStatusMessage] = useState("");
  var [draft, setDraft] = useState(createDraftTask("recurring", ""));

  var teamBoardQuery = useQuery({
    queryKey: TEAM_BOARD_QUERY_KEY,
    queryFn: fetchTeamBoard,
    staleTime: TEAM_BOARD_STALE_MS
  });
  var queryPayload = teamBoardQuery.data || { rows: [], status: "" };
  var rows = queryPayload.rows;
  var loading = teamBoardQuery.isPending;
  var apiStatus = queryPayload.status;
  var queryError = teamBoardQuery.isError
    ? (teamBoardQuery.error && teamBoardQuery.error.message ? teamBoardQuery.error.message : "Could not load team board")
    : "";

  useEffect(function() {
    if (typeof window === "undefined" || !window.__ppUser || !window.__ppUser.email) return;
    setCurrentUserEmail(String(window.__ppUser.email || "").trim().toLowerCase());
  }, []);

  useEffect(function() {
    setCadenceFilter("all");
    setSearchQuery("");
    setShowOnlyMine(false);
    setShowOnlyUrgent(false);
    setDraft(function(prev) {
      return prev && prev.id && prev.board_key === boardKey ? prev : createDraftTask(boardKey, currentUserEmail);
    });
  }, [boardKey, currentUserEmail]);

  var boardRows = useMemo(function() {
    var query = normalizeSearchText(searchQuery);
    return rows.filter(function(row) {
      if (row.board_key !== boardKey) return false;
      if (boardKey === "recurring" && cadenceFilter !== "all" && row.cadence !== cadenceFilter) return false;
      if (showOnlyMine && currentUserEmail && String(row.owner_email || "").trim().toLowerCase() !== currentUserEmail) return false;
      if (showOnlyUrgent && !isOverdue(row) && !isDueSoon(row)) return false;
      if (!rowMatchesSearch(row, query)) return false;
      return true;
    });
  }, [rows, boardKey, cadenceFilter, searchQuery, showOnlyMine, showOnlyUrgent, currentUserEmail]);

  var summary = useMemo(function() {
    return STATUS_COLUMNS.reduce(function(out, column) {
      out[column.key] = boardRows.filter(function(row) { return row.status === column.key; }).length;
      return out;
    }, { total: boardRows.length });
  }, [boardRows]);

  var columns = useMemo(function() {
    return STATUS_COLUMNS.map(function(column) {
      return {
        key: column.key,
        label: column.label,
        rows: boardRows.filter(function(row) { return row.status === column.key; })
      };
    });
  }, [boardRows]);

  var handleDraftChange = function(key, value) {
    setDraft(function(prev) {
      return Object.assign({}, prev, { [key]: value });
    });
  };

  var resetDraft = useCallback(function(nextBoardKey) {
    setDraft(createDraftTask(nextBoardKey || boardKey, currentUserEmail));
  }, [boardKey, currentUserEmail]);

  var updateBoardCache = function(updateRows, nextStatus) {
    queryClient.setQueryData(TEAM_BOARD_QUERY_KEY, function(prev) {
      var current = prev && typeof prev === "object" ? prev : { rows: [], status: "" };
      var nextRows = typeof updateRows === "function" ? updateRows(current.rows || []) : (current.rows || []);
      return {
        rows: sortRows(nextRows),
        status: nextStatus != null ? String(nextStatus || "") : String(current.status || "")
      };
    });
  };

  var upsertLocalRow = function(row) {
    updateBoardCache(function(prevRows) {
      return prevRows.filter(function(item) { return item.id !== row.id; }).concat([row]);
    });
  };

  var handleSave = useCallback(async function() {
    if (!String(draft.title || "").trim()) {
      setError("Task title is required.");
      return;
    }
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      var res = await fetch("/api/team/board", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_task",
          task: Object.assign({}, draft, { board_key: boardKey })
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body && body.error ? body.error : "Could not save task");
      if (body && body.status === "missing_team_board_table") {
        updateBoardCache(function(prevRows) { return prevRows; }, "missing_team_board_table");
        setStatusMessage("Team board table is not set up yet.");
        return;
      }
      if (body && body.row) upsertLocalRow(body.row);
      setStatusMessage(draft.id ? "Task updated." : "Task added.");
      resetDraft(boardKey);
    } catch (err) {
      setError(err && err.message ? err.message : "Could not save task");
    } finally {
      setSaving(false);
    }
  }, [boardKey, draft, resetDraft]);

  var handleSeed = useCallback(async function() {
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      var res = await fetch("/api/team/board", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed_defaults" })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body && body.error ? body.error : "Could not seed starter tasks");
      if (body && body.status === "missing_team_board_table") {
        updateBoardCache(function(prevRows) { return prevRows; }, "missing_team_board_table");
        setStatusMessage("Team board table is not set up yet.");
        return;
      }
      var inserted = Array.isArray(body && body.rows) ? body.rows : [];
      if (inserted.length) {
        updateBoardCache(function(prevRows) { return prevRows.concat(inserted); });
        setStatusMessage("Starter tasks added.");
      } else {
        setStatusMessage("Starter tasks already exist.");
      }
    } catch (err) {
      setError(err && err.message ? err.message : "Could not seed starter tasks");
    } finally {
      setSaving(false);
    }
  }, []);

  var handleArchive = useCallback(async function(row) {
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      var res = await fetch("/api/team/board", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive_task", id: row.id })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body && body.error ? body.error : "Could not archive task");
      updateBoardCache(function(prevRows) {
        return prevRows.filter(function(item) { return item.id !== row.id; });
      });
      setStatusMessage("Task archived.");
      if (draft.id === row.id) resetDraft(boardKey);
    } catch (err) {
      setError(err && err.message ? err.message : "Could not archive task");
    } finally {
      setSaving(false);
    }
  }, [boardKey, draft.id, resetDraft]);

  var handleEdit = function(row) {
    setBoardKey(row.board_key || "recurring");
    setDraft({
      id: row.id || "",
      board_key: row.board_key || "recurring",
      title: row.title || "",
      status: row.status || "todo",
      priority: row.priority || "medium",
      cadence: row.cadence || "adhoc",
      owner_email: row.owner_email || "",
      due_date: row.due_date || "",
      customer_name: row.customer_name || "",
      project_name: row.project_name || "",
      notes: row.notes || "",
      sort_order: Number(row.sort_order || Date.now())
    });
    setStatusMessage("");
    setError("");
  };

  var handleStatusAdvance = useCallback(async function(row) {
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      var next = Object.assign({}, row, { status: nextStatus(row.status) });
      var res = await fetch("/api/team/board", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsert_task", task: next })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body && body.error ? body.error : "Could not update task");
      if (body && body.row) upsertLocalRow(body.row);
    } catch (err) {
      setError(err && err.message ? err.message : "Could not update task");
    } finally {
      setSaving(false);
    }
  }, []);

  var mineVisibleCount = useMemo(function() {
    if (!currentUserEmail) return 0;
    return boardRows.filter(function(row) {
      return String(row.owner_email || "").trim().toLowerCase() === currentUserEmail;
    }).length;
  }, [boardRows, currentUserEmail]);

  var urgentVisibleCount = useMemo(function() {
    return boardRows.filter(function(row) {
      return isOverdue(row) || isDueSoon(row);
    }).length;
  }, [boardRows]);

  var showBoardEmptyState = !loading && apiStatus !== "missing_team_board_table" && boardRows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Team Board</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">A lightweight shared board for recurring work, onboarding, and miscellaneous projects.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleSeed} disabled={saving || apiStatus === "missing_team_board_table"}>Seed Starter Tasks</Button>
          <Button size="sm" variant="soft" onClick={function() { resetDraft(boardKey); }}>New Task</Button>
        </div>
      </div>

      <TabsNav
        activeKey={boardKey}
        onChange={setBoardKey}
        items={BOARD_ITEMS.map(function(item) { return { key: item.key, label: item.label }; })}
      />

      {boardKey === "recurring" ? (
        <div className="flex flex-wrap gap-2">
          {CADENCE_FILTERS.map(function(filter) {
            var isActive = cadenceFilter === filter.key;
            return (
              <Button
                key={filter.key}
                size="sm"
                variant={isActive ? "active" : "outline"}
                onClick={function() { setCadenceFilter(filter.key); }}
              >
                {filter.label}
              </Button>
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr),auto] lg:items-center">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto,auto]">
          <Input value={searchQuery} onChange={function(event) { setSearchQuery(event.target.value); }} placeholder="Search title, owner, customer, project, or notes" />
          <Button size="sm" variant={showOnlyMine ? "active" : "outline"} onClick={function() { setShowOnlyMine(function(prev) { return !prev; }); }} disabled={!currentUserEmail}>
            {currentUserEmail ? "My Tasks (" + mineVisibleCount + ")" : "My Tasks"}
          </Button>
          <Button size="sm" variant={showOnlyUrgent ? "active" : "outline"} onClick={function() { setShowOnlyUrgent(function(prev) { return !prev; }); }}>
            Urgent ({urgentVisibleCount})
          </Button>
        </div>
        <div className="text-xs text-[rgb(var(--muted))]">{boardRows.length} visible tasks</div>
      </div>

      {queryError || error ? <Card className="border-[rgb(var(--danger))] p-3 text-sm text-[rgb(var(--danger))]">{queryError || error}</Card> : null}
      {statusMessage ? <Card className="border-[rgb(var(--border))] p-3 text-sm text-[rgb(var(--muted))]">{statusMessage}</Card> : null}

      {apiStatus === "missing_team_board_table" ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Setup Required</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">Run the SQL in <code>/Users/aj/Documents/New project/docs/supabase-team-board.sql</code>, then refresh this page.</div>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STATUS_COLUMNS.map(function(column) {
          return (
            <Card key={column.key} className="p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--muted))]">{column.label}</div>
              <div className="mt-2 text-3xl font-semibold text-[rgb(var(--foreground))]">{summary[column.key] || 0}</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">{summary.total || 0} visible tasks</div>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px,1fr]">
        <Card className="xl:sticky xl:top-4">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{draft.id ? "Edit Task" : "Add Task"}</div>
                <div className="mt-1 text-xs text-[rgb(var(--muted))]">Keep tasks short and easy to move between columns.</div>
              </div>
              {draft.id ? <Badge variant="info">Editing</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[rgb(var(--muted))]">Title</label>
              <Input value={draft.title} onChange={function(event) { handleDraftChange("title", event.target.value); }} placeholder="Add a task title" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgb(var(--muted))]">Owner</label>
                <Input value={draft.owner_email} onChange={function(event) { handleDraftChange("owner_email", event.target.value); }} placeholder="name@company.com" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgb(var(--muted))]">Due Date</label>
                <Input type="date" value={draft.due_date} onChange={function(event) { handleDraftChange("due_date", event.target.value); }} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgb(var(--muted))]">Status</label>
                <select className="flex h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]" value={draft.status} onChange={function(event) { handleDraftChange("status", event.target.value); }}>
                  {STATUS_COLUMNS.map(function(option) {
                    return <option key={option.key} value={option.key}>{option.label}</option>;
                  })}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgb(var(--muted))]">Priority</label>
                <select className="flex h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]" value={draft.priority} onChange={function(event) { handleDraftChange("priority", event.target.value); }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgb(var(--muted))]">Cadence</label>
                <select className="flex h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]" value={draft.cadence} onChange={function(event) { handleDraftChange("cadence", event.target.value); }}>
                  <option value="adhoc">Ad hoc</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="onboarding">Onboarding</option>
                </select>
              </div>
            </div>

            {boardKey === "onboarding" ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgb(var(--muted))]">Customer</label>
                <Input value={draft.customer_name} onChange={function(event) { handleDraftChange("customer_name", event.target.value); }} placeholder="Customer name" />
              </div>
            ) : null}

            {boardKey === "projects" ? (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[rgb(var(--muted))]">Project</label>
                <Input value={draft.project_name} onChange={function(event) { handleDraftChange("project_name", event.target.value); }} placeholder="Project name" />
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-xs font-medium text-[rgb(var(--muted))]">Notes</label>
              <textarea
                value={draft.notes}
                onChange={function(event) { handleDraftChange("notes", event.target.value); }}
                rows={5}
                placeholder="Short context, handoff note, or checklist reminder"
                className="w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 py-2 text-sm text-[rgb(var(--foreground))] outline-none ring-offset-1 focus:ring-2 focus:ring-[rgb(var(--accent))]"
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant="default" onClick={handleSave} disabled={saving}>{draft.id ? "Save Changes" : "Add Task"}</Button>
              <Button size="sm" variant="outline" onClick={function() { resetDraft(boardKey); }} disabled={saving}>{draft.id ? "Cancel Edit" : "Reset"}</Button>
            </div>
          </CardContent>
        </Card>

        {showBoardEmptyState ? (
          <Card className="p-6">
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">No matching tasks yet</div>
            <div className="mt-2 max-w-2xl text-sm text-[rgb(var(--muted))]">
              {rows.length
                ? "Your current filters removed everything from view. Clear the filters or add a new task for this board."
                : "Start with starter tasks, or add your first task manually. Keep recurring items short and actionable so the board stays easy to maintain."}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {!rows.length ? <Button size="sm" variant="outline" onClick={handleSeed} disabled={saving}>Seed Starter Tasks</Button> : null}
              <Button size="sm" variant="soft" onClick={function() {
                setSearchQuery("");
                setShowOnlyMine(false);
                setShowOnlyUrgent(false);
                setCadenceFilter("all");
                resetDraft(boardKey);
              }}>Clear Filters</Button>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-4">
            {columns.map(function(column) {
              return (
                <div key={column.key} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{column.label}</div>
                    <Badge variant={statusVariant(column.key)}>{column.rows.length}</Badge>
                  </div>
                  {loading ? (
                    <Card className="p-4 text-sm text-[rgb(var(--muted))]">Loading tasks...</Card>
                  ) : column.rows.length ? (
                    column.rows.map(function(row) {
                      var due = dueBadge(row);
                      return (
                        <Card key={row.id}>
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{row.title}</div>
                              <Badge variant={priorityVariant(row.priority)}>{row.priority}</Badge>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                              <Badge variant="secondary">{row.cadence === "adhoc" ? "Ad hoc" : row.cadence}</Badge>
                              {due ? <Badge variant={due.variant}>{due.label}</Badge> : null}
                              {row.customer_name ? <Badge variant="info">{row.customer_name}</Badge> : null}
                              {row.project_name ? <Badge variant="info">{row.project_name}</Badge> : null}
                            </div>
                            {row.owner_email ? (
                              <div className="text-xs text-[rgb(var(--muted))]">
                                <div>{row.owner_email}</div>
                              </div>
                            ) : null}
                            {row.notes ? <div className="text-sm text-[rgb(var(--muted))]">{row.notes}</div> : null}
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="outline" onClick={function() { handleStatusAdvance(row); }} disabled={saving}>{nextStatusLabel(row.status)}</Button>
                              <Button size="sm" variant="soft" onClick={function() { handleEdit(row); }} disabled={saving}>Edit</Button>
                              <Button size="sm" variant="ghost" onClick={function() { handleArchive(row); }} disabled={saving}>Archive</Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  ) : (
                    <Card className="p-4 text-sm text-[rgb(var(--muted))]">No tasks in this column yet.</Card>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
