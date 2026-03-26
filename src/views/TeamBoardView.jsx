import { useCallback, useEffect, useMemo, useState } from "react";
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

function sortRows(rows) {
  return (Array.isArray(rows) ? rows.slice() : []).sort(function(a, b) {
    var boardCompare = String(a.board_key || "").localeCompare(String(b.board_key || ""));
    if (boardCompare) return boardCompare;
    var sortCompare = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (sortCompare) return sortCompare;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });
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

export default function TeamBoardView() {
  var [boardKey, setBoardKey] = useState("recurring");
  var [cadenceFilter, setCadenceFilter] = useState("all");
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [saving, setSaving] = useState(false);
  var [error, setError] = useState("");
  var [statusMessage, setStatusMessage] = useState("");
  var [apiStatus, setApiStatus] = useState("");
  var [draft, setDraft] = useState(createBlankTask("recurring"));

  var loadRows = useCallback(async function() {
    setLoading(true);
    setError("");
    try {
      var res = await fetch("/api/team/board", { credentials: "include" });
      var body = await res.json();
      if (!res.ok) throw new Error(body && body.error ? body.error : "Could not load team board");
      setRows(sortRows(body && Array.isArray(body.rows) ? body.rows : []));
      setApiStatus(String((body && body.status) || ""));
      if (body && body.status === "missing_team_board_table") {
        setStatusMessage("Team board table is not set up yet.");
      }
    } catch (err) {
      setError(err && err.message ? err.message : "Could not load team board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function() {
    loadRows();
  }, [loadRows]);

  useEffect(function() {
    setCadenceFilter("all");
    setDraft(function(prev) {
      return prev && prev.id && prev.board_key === boardKey ? prev : createBlankTask(boardKey);
    });
  }, [boardKey]);

  var boardRows = useMemo(function() {
    return rows.filter(function(row) {
      if (row.board_key !== boardKey) return false;
      if (boardKey !== "recurring" || cadenceFilter === "all") return true;
      return row.cadence === cadenceFilter;
    });
  }, [rows, boardKey, cadenceFilter]);

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
    setDraft(createBlankTask(nextBoardKey || boardKey));
  }, [boardKey]);

  var upsertLocalRow = function(row) {
    setRows(function(prev) {
      var next = prev.filter(function(item) { return item.id !== row.id; }).concat([row]);
      return sortRows(next);
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
        setApiStatus("missing_team_board_table");
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
        setApiStatus("missing_team_board_table");
        setStatusMessage("Team board table is not set up yet.");
        return;
      }
      var inserted = Array.isArray(body && body.rows) ? body.rows : [];
      if (inserted.length) {
        setRows(function(prev) { return sortRows(prev.concat(inserted)); });
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
      setRows(function(prev) { return prev.filter(function(item) { return item.id !== row.id; }); });
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

      {error ? <Card className="border-[rgb(var(--danger))] p-3 text-sm text-[rgb(var(--danger))]">{error}</Card> : null}
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
              <Button size="sm" variant="outline" onClick={function() { resetDraft(boardKey); }} disabled={saving}>Reset</Button>
            </div>
          </CardContent>
        </Card>

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
                            <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                            <Badge variant="secondary">{row.cadence === "adhoc" ? "Ad hoc" : row.cadence}</Badge>
                            {row.customer_name ? <Badge variant="info">{row.customer_name}</Badge> : null}
                            {row.project_name ? <Badge variant="info">{row.project_name}</Badge> : null}
                          </div>
                          {(row.owner_email || row.due_date) ? (
                            <div className="text-xs text-[rgb(var(--muted))]">
                              {row.owner_email ? <div>{row.owner_email}</div> : null}
                              {row.due_date ? <div>Due {formatDateLabel(row.due_date)}</div> : null}
                            </div>
                          ) : null}
                          {row.notes ? <div className="text-sm text-[rgb(var(--muted))]">{row.notes}</div> : null}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={function() { handleStatusAdvance(row); }} disabled={saving}>{row.status === "done" ? "Reopen" : "Move Next"}</Button>
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
      </div>
    </div>
  );
}
