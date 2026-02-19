import { useState, useCallback, useRef, useEffect } from "react";

// Nulogy sync statuses
const IDLE = "idle";
const TESTING = "testing";
const CREATING = "creating";
const POLLING = "polling";
const DOWNLOADING = "downloading";
const DONE = "done";
const ERROR = "error";

const REPORT_TYPES = [
  { key: "inventory", label: "Inventory", required: true },
  { key: "workorders", label: "Work Orders", required: true },
  { key: "bom", label: "Bill of Materials", required: false }
];

const POLL_INTERVAL = 4000; // 4 seconds between polls
const MAX_POLLS = 60; // max ~4 minutes of polling

export default function NulogySync({ onDataLoaded, theme }) {
  const C = theme;
  const sans = "'IBM Plex Sans', -apple-system, sans-serif";
  const mono = "'IBM Plex Mono', monospace";

  const [expanded, setExpanded] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null); // null | {configured, connected, message}
  const [syncing, setSyncing] = useState(false);
  const [reportStates, setReportStates] = useState({
    inventory: { status: IDLE, progress: "", error: null, rowCount: 0 },
    workorders: { status: IDLE, progress: "", error: null, rowCount: 0 },
    bom: { status: IDLE, progress: "", error: null, rowCount: 0 }
  });
  const [syncTypes, setSyncTypes] = useState(["inventory", "workorders", "bom"]);
  const abortRef = useRef(false);

  // Test connection on first expand
  useEffect(() => {
    if (expanded && connectionStatus === null) {
      testConnection();
    }
  }, [expanded]);

  const testConnection = useCallback(async () => {
    setConnectionStatus({ testing: true });
    try {
      const res = await fetch("/api/nulogy/test");
      const data = await res.json();
      setConnectionStatus(data);
    } catch (err) {
      setConnectionStatus({
        configured: false,
        connected: false,
        message: "Could not reach PackPulse API. Try refreshing."
      });
    }
  }, []);

  const updateReportState = useCallback((type, update) => {
    setReportStates(prev => ({
      ...prev,
      [type]: { ...prev[type], ...update }
    }));
  }, []);

  const syncReport = useCallback(async (type) => {
    if (abortRef.current) return null;

    // Step 1: Create report job
    updateReportState(type, { status: CREATING, progress: "Requesting report from Nulogy...", error: null });

    let taskData;
    try {
      const createRes = await fetch("/api/nulogy/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType: type })
      });
      if (!createRes.ok) {
        const err = await createRes.json();
        // Show detailed diagnostics if available
        let errorMsg = err.error || `HTTP ${createRes.status}`;
        if (err.attempts && err.attempts.length > 0) {
          const details = err.attempts.map(a =>
            `Attempt ${a.attempt}: ${(a.nulogyError || a.error || "unknown").substring(0, 200)}`
          ).join(" | ");
          errorMsg += " — DETAILS: " + details;
        }
        throw new Error(errorMsg);
      }
      taskData = await createRes.json();
    } catch (err) {
      updateReportState(type, { status: ERROR, progress: "", error: err.message });
      return null;
    }

    // Step 2: Poll for completion
    updateReportState(type, { status: POLLING, progress: "Generating report..." });

    let downloadUrl = null;
    let polls = 0;

    while (!downloadUrl && polls < MAX_POLLS && !abortRef.current) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      polls++;

      try {
        const statusRes = await fetch(`/api/nulogy/status?url=${encodeURIComponent(taskData.statusUrl)}`);
        if (!statusRes.ok) {
          const err = await statusRes.json();
          throw new Error(err.error || `HTTP ${statusRes.status}`);
        }
        const statusData = await statusRes.json();

        if (statusData.status === "COMPLETED" && statusData.downloadUrl) {
          downloadUrl = statusData.downloadUrl;
        } else if (statusData.status === "FAILED" || statusData.status === "ERROR") {
          throw new Error("Nulogy report generation failed.");
        } else {
          updateReportState(type, { progress: `Generating report... (${polls * 4}s)` });
        }
      } catch (err) {
        updateReportState(type, { status: ERROR, progress: "", error: err.message });
        return null;
      }
    }

    if (abortRef.current) return null;

    if (!downloadUrl) {
      updateReportState(type, { status: ERROR, progress: "", error: "Report generation timed out. Try again." });
      return null;
    }

    // Step 3: Download and transform
    updateReportState(type, { status: DOWNLOADING, progress: "Downloading data..." });

    try {
      const dlRes = await fetch(`/api/nulogy/download?url=${encodeURIComponent(downloadUrl)}&type=${type}`);
      if (!dlRes.ok) {
        const err = await dlRes.json();
        throw new Error(err.error || `HTTP ${dlRes.status}`);
      }
      const dlData = await dlRes.json();

      updateReportState(type, {
        status: DONE,
        progress: `${dlData.rowCount.toLocaleString()} rows loaded`,
        rowCount: dlData.rowCount
      });

      return { type, data: dlData.data, rowCount: dlData.rowCount };

    } catch (err) {
      updateReportState(type, { status: ERROR, progress: "", error: err.message });
      return null;
    }
  }, [updateReportState]);

  const startSync = useCallback(async () => {
    abortRef.current = false;
    setSyncing(true);

    // Reset states for selected types
    const resetStates = {};
    syncTypes.forEach(t => {
      resetStates[t] = { status: IDLE, progress: "Waiting...", error: null, rowCount: 0 };
    });
    setReportStates(prev => ({ ...prev, ...resetStates }));

    // Run reports sequentially (Nulogy docs recommend not running concurrent reports)
    const results = {};
    for (const type of syncTypes) {
      if (abortRef.current) break;
      const result = await syncReport(type);
      if (result) results[type] = result;
    }

    // Send loaded data to parent
    if (Object.keys(results).length > 0) {
      onDataLoaded(results);
    }

    setSyncing(false);
  }, [syncTypes, syncReport, onDataLoaded]);

  const cancelSync = useCallback(() => {
    abortRef.current = true;
    setSyncing(false);
  }, []);

  const toggleSyncType = useCallback((type) => {
    setSyncTypes(prev => {
      if (prev.includes(type)) return prev.filter(t => t !== type);
      return [...prev, type];
    });
  }, []);

  // Status icon helper
  const StatusIcon = ({ status }) => {
    if (status === DONE) return <span style={{ color: C.ok, fontWeight: 700 }}>✓</span>;
    if (status === ERROR) return <span style={{ color: C.bad, fontWeight: 700 }}>✗</span>;
    if (status === IDLE) return <span style={{ color: C.dim }}>○</span>;
    // Spinning for active states
    return (
      <span style={{
        display: "inline-block", width: 14, height: 14,
        border: "2px solid " + C.border, borderTopColor: C.accent,
        borderRadius: "50%", animation: "nulogy-spin 0.8s linear infinite",
        verticalAlign: "middle"
      }} />
    );
  };

  const connDot = connectionStatus?.connected ? C.ok
    : connectionStatus?.configured ? C.warn
    : connectionStatus?.testing ? C.dim
    : C.border;

  return (
    <div style={{ marginBottom: 16 }}>
      <style>{`@keyframes nulogy-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px", border: "1px solid " + (connectionStatus?.connected ? C.okLine : C.border),
          borderRadius: expanded ? "8px 8px 0 0" : 8,
          cursor: "pointer",
          background: connectionStatus?.connected ? C.okSoft : C.surface
        }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: connectionStatus?.connected ? C.ok : C.raised,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, color: connectionStatus?.connected ? "#fff" : C.dim,
          fontWeight: 700, flexShrink: 0
        }}>
          {connectionStatus?.connected ? "⟳" : "N"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.bright, fontFamily: sans }}>
            Sync from Nulogy
          </div>
          <div style={{ fontSize: 13, color: C.dim, fontFamily: sans, marginTop: 1 }}>
            {connectionStatus?.connected
              ? "Connected — pull live data from Nulogy"
              : connectionStatus?.configured
              ? "Credentials set but not connected"
              : "Pull inventory, WOs, and BOMs from Nulogy"}
          </div>
        </div>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: connDot, flexShrink: 0
        }} />
        <span style={{ fontSize: 13, color: C.dim, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▸</span>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{
          border: "1px solid " + C.border, borderTop: "none",
          borderRadius: "0 0 8px 8px", padding: "14px 16px",
          background: C.surface
        }}>
          {/* Connection status */}
          {connectionStatus?.testing && (
            <div style={{ fontSize: 13, color: C.dim, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                display: "inline-block", width: 12, height: 12,
                border: "2px solid " + C.border, borderTopColor: C.accent,
                borderRadius: "50%", animation: "nulogy-spin 0.8s linear infinite"
              }} />
              Testing connection...
            </div>
          )}

          {connectionStatus && !connectionStatus.testing && !connectionStatus.connected && (
            <div style={{
              padding: "10px 12px", borderRadius: 6, marginBottom: 12,
              background: C.badSoft, border: "1px solid " + C.badLine
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.bad, marginBottom: 2 }}>
                {connectionStatus.configured ? "Connection Failed" : "Not Configured"}
              </div>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                {connectionStatus.message}
              </div>
              {!connectionStatus.configured && (
                <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>
                  Go to <span style={{ color: C.accent, fontWeight: 600 }}>Vercel → Settings → Environment Variables</span> and add:<br/>
                  <code style={{ fontFamily: mono, fontSize: 12, color: C.bright }}>NULOGY_USER</code> — your Nulogy login email<br/>
                  <code style={{ fontFamily: mono, fontSize: 12, color: C.bright }}>NULOGY_PASS</code> — your Nulogy password<br/>
                  <code style={{ fontFamily: mono, fontSize: 12, color: C.bright }}>NULOGY_SITE_UUID</code> — (optional) specific site UUID
                </div>
              )}
              <button
                onClick={testConnection}
                style={{
                  marginTop: 8, padding: "4px 12px", borderRadius: 6,
                  border: "1px solid " + C.border, background: "transparent",
                  color: C.dim, fontFamily: sans, fontSize: 12, cursor: "pointer"
                }}
              >
                Retry
              </button>
            </div>
          )}

          {connectionStatus?.connected && (
            <>
              <div style={{
                fontSize: 13, color: C.ok, marginBottom: 12,
                display: "flex", alignItems: "center", gap: 6
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.ok }} />
                Connected to {connectionStatus.url || "app.nulogy.net"}
                {connectionStatus.user && (
                  <span style={{ color: C.dim }}> as {connectionStatus.user}</span>
                )}
              </div>

              {/* Report type toggles */}
              {!syncing && (
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  {REPORT_TYPES.map(rt => {
                    const on = syncTypes.includes(rt.key);
                    const st = reportStates[rt.key];
                    return (
                      <button
                        key={rt.key}
                        onClick={() => !rt.required && toggleSyncType(rt.key)}
                        style={{
                          padding: "5px 12px", borderRadius: 16,
                          border: "1px solid " + (on ? C.accentLine : C.border),
                          background: on ? C.accentSoft : "transparent",
                          color: on ? C.accent : C.dim,
                          fontFamily: sans, fontSize: 13, fontWeight: 500,
                          cursor: rt.required ? "default" : "pointer",
                          display: "flex", alignItems: "center", gap: 5
                        }}
                      >
                        {on ? "✓" : ""} {rt.label}
                        {rt.required && <span style={{ fontSize: 11, opacity: 0.5 }}>req</span>}
                        {st.status === DONE && (
                          <span style={{ fontSize: 11, color: C.ok }}>{st.rowCount.toLocaleString()}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Sync progress */}
              {syncing && (
                <div style={{ marginBottom: 12 }}>
                  {syncTypes.map(type => {
                    const st = reportStates[type];
                    const rt = REPORT_TYPES.find(r => r.key === type);
                    return (
                      <div key={type} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 0", borderBottom: "1px solid " + C.border
                      }}>
                        <StatusIcon status={st.status} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.bright, minWidth: 90 }}>
                          {rt.label}
                        </span>
                        <span style={{ fontSize: 13, color: st.error ? C.bad : C.dim, flex: 1, wordBreak: "break-word", lineHeight: 1.4 }}>
                          {st.error || st.progress || "Waiting..."}
                        </span>
                        {st.status === DONE && (
                          <span style={{ fontSize: 12, fontFamily: mono, color: C.ok }}>
                            {st.rowCount.toLocaleString()} rows
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {!syncing ? (
                  <button
                    onClick={startSync}
                    disabled={syncTypes.length === 0}
                    style={{
                      padding: "8px 20px", borderRadius: 6, border: "none",
                      background: syncTypes.length > 0 ? C.accent : C.raised,
                      color: syncTypes.length > 0 ? "#fff" : C.dim,
                      fontFamily: sans, fontSize: 14, fontWeight: 600,
                      cursor: syncTypes.length > 0 ? "pointer" : "not-allowed"
                    }}
                  >
                    Pull Data from Nulogy
                  </button>
                ) : (
                  <button
                    onClick={cancelSync}
                    style={{
                      padding: "8px 20px", borderRadius: 6,
                      border: "1px solid " + C.badLine,
                      background: C.badSoft, color: C.bad,
                      fontFamily: sans, fontSize: 14, fontWeight: 600, cursor: "pointer"
                    }}
                  >
                    Cancel
                  </button>
                )}

                {!syncing && Object.values(reportStates).some(s => s.status === DONE) && (
                  <span style={{ fontSize: 13, color: C.ok }}>
                    ✓ Data loaded — click Analyze to continue
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
