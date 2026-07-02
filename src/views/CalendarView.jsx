import { useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

var TEAM_CALENDAR_EMBED_URL = "https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FNew_York&src=Y185MGM1MWU3ZTY1ZjBjNWE4Njg0ZWVlZjg3MDA2NDA5YmM3ZDM0ZWY1OTk1YWQ3ZTFiMmJlMDlkMzM5YmNlODNkQGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20&src=ZmdudThhdDhzaGFia2VhbTY1MGVzZDUxN2k1MXAwdmNAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23c0ca33&color=%23d81b60";

function formatDateLabel(value) {
  var date = new Date(String(value || "") + "T12:00:00");
  if (isNaN(date)) return value || "--";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function formatTimestamp(value) {
  if (!value) return "";
  var date = new Date(value);
  if (isNaN(date)) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatHours(value) {
  var n = Number(value || 0);
  if (!Number.isFinite(n)) return "0h";
  var rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toFixed(0) + "h" : rounded.toFixed(1) + "h";
}

function statusVariant(status) {
  var value = String(status || "").toLowerCase();
  if (value === "approved") return "success";
  if (value === "pending") return "warning";
  if (value === "declined") return "danger";
  if (value === "consumed") return "secondary";
  return "default";
}

export default function CalendarView() {
  const [timeOffState, setTimeOffState] = useState({
    status: "loading",
    setupState: "unknown",
    syncConfigured: false,
    lastSyncedAt: null,
    summary: null,
    entries: [],
    error: ""
  });
  const [syncState, setSyncState] = useState({
    status: "idle",
    message: ""
  });

  useEffect(function() {
    let cancelled = false;

    async function loadTimeOff() {
      try {
        setTimeOffState(function(prev) {
          return Object.assign({}, prev, { status: "loading", error: "" });
        });
        var response = await fetch("/api/gusto/time-off?days=45");
        var payload = await response.json().catch(function() { return {}; });
        if (!response.ok) throw new Error(payload && payload.details ? payload.details : "Could not load Gusto time off.");
        if (cancelled) return;
        setTimeOffState({
          status: "ready",
          setupState: payload.setupState || "ready",
          syncConfigured: !!payload.syncConfigured,
          lastSyncedAt: payload.lastSyncedAt || null,
          summary: payload.summary || null,
          entries: Array.isArray(payload.entries) ? payload.entries.slice(0, 12) : [],
          error: ""
        });
      } catch (error) {
        if (cancelled) return;
        setTimeOffState({
          status: "error",
          setupState: "unknown",
          syncConfigured: false,
          lastSyncedAt: null,
          summary: null,
          entries: [],
          error: String(error && error.message || "Could not load Gusto time off.")
        });
      }
    }

    loadTimeOff();
    return function() {
      cancelled = true;
    };
  }, []);

  async function refreshTimeOff() {
    try {
      setTimeOffState(function(prev) {
        return Object.assign({}, prev, { status: "loading", error: "" });
      });
      var response = await fetch("/api/gusto/time-off?days=45");
      var payload = await response.json().catch(function() { return {}; });
      if (!response.ok) throw new Error(payload && payload.details ? payload.details : "Could not load Gusto time off.");
      setTimeOffState({
        status: "ready",
        setupState: payload.setupState || "ready",
        syncConfigured: !!payload.syncConfigured,
        lastSyncedAt: payload.lastSyncedAt || null,
        summary: payload.summary || null,
        entries: Array.isArray(payload.entries) ? payload.entries.slice(0, 12) : [],
        error: ""
      });
    } catch (error) {
      setTimeOffState({
        status: "error",
        setupState: "unknown",
        syncConfigured: false,
        lastSyncedAt: null,
        summary: null,
        entries: [],
        error: String(error && error.message || "Could not load Gusto time off.")
      });
    }
  }

  async function handleSync() {
    try {
      setSyncState({ status: "running", message: "" });
      var response = await fetch("/api/gusto/sync-time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      var payload = await response.json().catch(function() { return {}; });
      if (!response.ok || payload.ok === false) {
        throw new Error(payload && (payload.details || payload.error) ? (payload.details || payload.error) : "Gusto sync failed.");
      }
      setSyncState({
        status: payload.status === "partial" ? "partial" : "success",
        message: payload.status === "partial"
          ? "Sync completed with partial results."
          : "Gusto time off synced."
      });
      await refreshTimeOff();
    } catch (error) {
      setSyncState({
        status: "error",
        message: String(error && error.message || "Gusto sync failed.")
      });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="border-b border-[rgb(var(--border))] px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-base font-semibold text-[rgb(var(--foreground))]">Upcoming Gusto Time Off</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                Cached PTO and call-off visibility from Gusto App Integrations for the next 45 days.
              </div>
              {timeOffState.lastSyncedAt ? (
                <div className="mt-2 text-xs text-[rgb(var(--muted))]">
                  Last synced {formatTimestamp(timeOffState.lastSyncedAt)}
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={
                  syncState.status === "running" ||
                  !timeOffState.syncConfigured ||
                  timeOffState.setupState === "missing_table"
                }
              >
                {syncState.status === "running" ? "Syncing..." : "Sync Gusto"}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant={timeOffState.setupState === "missing_table" ? "warning" : "info"}>
              {timeOffState.setupState === "missing_table" ? "Setup Needed" : "Cached Feed"}
            </Badge>
            <Badge variant={timeOffState.syncConfigured ? "success" : "warning"}>
              {timeOffState.syncConfigured ? "Sync Configured" : "Sync Not Configured"}
            </Badge>
            {timeOffState.summary ? (
              <>
                <Badge variant="secondary">{timeOffState.summary.requestCount} requests</Badge>
                <Badge variant="secondary">{timeOffState.summary.uniqueEmployees} teammates</Badge>
                <Badge variant="secondary">{formatHours(timeOffState.summary.totalHours)} scheduled</Badge>
              </>
            ) : null}
          </div>
          {syncState.message ? (
            <div className={"mt-3 text-sm " + (syncState.status === "error" ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--muted))]")}>
              {syncState.message}
            </div>
          ) : null}
        </div>
        <div className="space-y-3 px-4 py-4">
          {timeOffState.status === "loading" ? (
            <div className="text-sm text-[rgb(var(--muted))]">Loading Gusto time off...</div>
          ) : null}
          {timeOffState.status === "error" ? (
            <div className="text-sm text-[rgb(var(--danger))]">{timeOffState.error}</div>
          ) : null}
          {timeOffState.setupState === "missing_table" ? (
            <div className="text-sm text-[rgb(var(--muted))]">
              Run the Supabase setup for `gusto_time_off_requests` before using this feed.
            </div>
          ) : null}
          {timeOffState.status === "ready" && !timeOffState.entries.length && timeOffState.setupState !== "missing_table" ? (
            <div className="text-sm text-[rgb(var(--muted))]">
              No upcoming Gusto time off is cached yet.
            </div>
          ) : null}
          {timeOffState.entries.length ? (
            <div className="grid gap-2">
              {timeOffState.entries.map(function(entry) {
                return (
                  <div
                    key={entry.request_uuid + ":" + entry.date}
                    className="flex flex-col gap-2 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="text-sm font-medium text-[rgb(var(--foreground))]">{entry.employee_name || "Unknown teammate"}</div>
                      <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                        {formatDateLabel(entry.date)} · {formatHours(entry.hours)} · {entry.policy_type || "time off"}
                      </div>
                      {entry.employee_note ? (
                        <div className="mt-1 text-xs text-[rgb(var(--muted))]">{entry.employee_note}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[rgb(var(--border))] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">Team Calendar</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Shared Google Calendar embedded directly in PackPulse for team schedule visibility.
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={TEAM_CALENDAR_EMBED_URL} target="_blank" rel="noreferrer">
              Open in Google Calendar
            </a>
          </Button>
        </div>
        <div className="bg-[rgb(var(--background))] p-2 sm:p-4">
          <iframe
            title="PackPulse team calendar"
            src={TEAM_CALENDAR_EMBED_URL}
            className="block h-[72vh] min-h-[560px] w-full rounded-md border border-[rgb(var(--border))] bg-white"
            frameBorder="0"
            scrolling="no"
            loading="lazy"
          />
        </div>
      </Card>
    </div>
  );
}
