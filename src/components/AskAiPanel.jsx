import { useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";

function buildPrototypeReply(text, context) {
  var q = (text || "").toLowerCase();
  if (!q.trim()) return "Type a question and I can draft an ops-focused answer from the current tab context.";

  if (q.includes("run next") || q.includes("what should we run")) {
    return "Fallback answer: prioritize WOs with highest net units, nearest due dates, and lowest shared-component risk.";
  }
  if (q.includes("risk") || q.includes("short")) {
    return "Fallback answer: focus first on high-impact shortages (units at risk + due date urgency), then split by packaging vs WIP to route ownership faster.";
  }
  if (q.includes("production") || q.includes("yield") || q.includes("operations")) {
    return "Fallback answer: compare actual vs baseline by day, then drill into line-level variance and shift mix to isolate throughput loss.";
  }
  if (q.includes("delivery") || q.includes("inbound") || q.includes("dock")) {
    return "Fallback answer: anchor to OpenDock scheduled inbounds, then layer EDR confidence. Flag unknown/unmatched loads separately to avoid false certainty.";
  }
  return (
    "Fallback answer for " +
    context +
    ": I can summarize this view and recommend top actions."
  );
}

export default function AskAiPanel(props) {
  var open = !!props.open;
  var onClose = props.onClose;
  var activeView = props.activeView || "overview";
  var contextLines = Array.isArray(props.contextLines) ? props.contextLines : [];
  var labelByView = {
    overview: "Overview",
    operations: "Operations",
    workorders: "Work Orders",
    supplyrisk: "Supply Risk",
    sandbox: "Sandbox",
    flags: "Data Flags",
  };

  var viewLabel = labelByView[activeView] || "Current View";
  var [draft, setDraft] = useState("");
  var [sending, setSending] = useState(false);
  var [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Ask AI is ready. Ask about run priorities, supply risk, or production trends.",
    },
  ]);

  var suggestions = useMemo(function() {
    if (activeView === "workorders") {
      return [
        "What should we run next and why?",
        "Which work orders are changeover risks?",
        "Summarize top blockers in one paragraph.",
      ];
    }
    if (activeView === "supplyrisk") {
      return [
        "Which shortages are most urgent today?",
        "What is missing vs unscheduled?",
        "What should supply chain do first?",
      ];
    }
    if (activeView === "operations") {
      return [
        "Summarize today vs yesterday output.",
        "Which line is underperforming?",
        "Where is the largest variance this week?",
      ];
    }
    return [
      "Summarize this dashboard in 5 bullets.",
      "What are top 3 actions for today?",
      "What changed since last review?",
    ];
  }, [activeView]);

  function sendMessage(text) {
    if (sending) return;
    var prompt = (text || draft || "").trim();
    if (!prompt) return;
    var nextMessages = messages.concat([{ role: "user", text: prompt }]);
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        prompt: prompt,
        activeView: activeView,
        contextLines: contextLines,
        history: nextMessages.slice(-8),
      }),
    })
      .then(async function(r) {
        var body = await r.json().catch(function() { return {}; });
        if (!r.ok) {
          var detail = body && (body.details || body.error) ? (body.details || body.error) : "AI request failed";
          throw new Error(detail);
        }
        var answer = body && body.answer ? String(body.answer) : "";
        if (!answer) answer = "No AI response returned.";
        setMessages(function(prev) {
          return prev.concat([{ role: "assistant", text: answer }]);
        });
      })
      .catch(function(err) {
        var reason = err && err.message ? String(err.message) : "AI route unavailable";
        var fallback = buildPrototypeReply(prompt, viewLabel);
        setMessages(function(prev) {
          return prev.concat([{ role: "assistant", text: fallback + "\n\n(Using fallback: " + reason + ")" }]);
        });
      })
      .finally(function() {
        setSending(false);
      });
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-[110] bg-black/35" onClick={onClose} />}
      <aside
        className={
          "fixed right-0 top-0 z-[120] h-screen w-full max-w-[420px] border-l border-[rgb(var(--border))] bg-[rgb(var(--surface))] shadow-2xl transition-transform duration-200 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
        aria-hidden={!open}
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-[rgb(var(--border))] px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-base font-semibold text-[rgb(var(--foreground))]">Ask AI</div>
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success">Live</Badge>
              <span className="text-xs text-[rgb(var(--muted))]">{viewLabel}</span>
            </div>
            {contextLines.length ? (
              <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                {contextLines.slice(0, 3).map(function(line, idx) {
                  return <div key={idx}>• {line}</div>;
                })}
              </div>
            ) : null}
          </div>

          <div className="border-b border-[rgb(var(--border))] px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[rgb(var(--muted))]">Suggested</div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map(function(s) {
                return (
                  <button
                    key={s}
                    onClick={function() { sendMessage(s); }}
                    className="rounded-md border border-[rgb(var(--border))] bg-white px-2 py-1 text-left text-xs text-[rgb(var(--foreground))] hover:border-[rgb(var(--accent))]"
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.map(function(m, idx) {
              var isUser = m.role === "user";
              return (
                <div
                  key={idx}
                  className={
                    "max-w-[95%] rounded-md border px-3 py-2 text-sm " +
                    (isUser
                      ? "ml-auto border-[rgb(var(--accent))] bg-[rgba(var(--accent-rgb),0.08)] text-[rgb(var(--foreground))]"
                      : "mr-auto border-[rgb(var(--border))] bg-white text-[rgb(var(--foreground))]")
                  }
                >
                  {m.text}
                </div>
              );
            })}
          </div>

          <div className="border-t border-[rgb(var(--border))] px-4 py-3">
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={function(e) { setDraft(e.target.value); }}
                onKeyDown={function(e) {
                  if (e.key === "Enter") sendMessage();
                }}
                placeholder="Ask about risk, production, or what to run next..."
              />
              <Button onClick={function() { sendMessage(); }} size="sm" disabled={sending}>
                {sending ? "Sending..." : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
