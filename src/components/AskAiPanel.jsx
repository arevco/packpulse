import { Fragment, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";

function introByView(activeView) {
  if (activeView === "workorders") {
    return "Ask the copilot to rank the next run, surface batching wins, or turn the queue into a supervisor-ready plan.";
  }
  if (activeView === "supplyrisk") {
    return "Ask the copilot to expose the sharpest shortages, sort urgent supply-chain moves, or convert the watchlist into clear owner actions.";
  }
  if (activeView === "operations") {
    return "Ask the copilot to frame output pace, loss signals, recovery moves, or a shift handoff from current operations data.";
  }
  if (activeView === "aicopilot") {
    return "Use the copilot like a command center: diagnose the operation, recommend moves, simulate scenarios, ideate new options, and still generate standup or executive briefs on demand.";
  }
  return "Ask the copilot to summarize this view, explain what changed, or recommend the next best move from the current dashboard context.";
}

function buildPrototypeReply(text, context, mode) {
  var q = (text || "").toLowerCase();
  var activeMode = String(mode || "").toLowerCase();
  if (!q.trim()) return "Type a question and I can draft an ops-focused answer from the current tab context.";

  if (activeMode === "standup" || q.includes("standup")) {
    return [
      "**1) Today Snapshot**",
      "- Output, risk, and queue signals are ready to turn into a standup brief.",
      "",
      "**2) Top Risks**",
      "- Shortages, blocked work orders, and throughput losses should be the first lens.",
      "",
      "**3) Actions By Role**",
      "- Planner: lock the next sequence.",
      "- Supply Chain: protect the sharpest shortages.",
      "- Floor Lead: attack the biggest throughput loss.",
      "",
      "**4) Confidence / Source**",
      "- Fallback answer only; the AI route was unavailable."
    ].join("\n");
  }
  if (q.includes("run next") || q.includes("what should we run") || activeMode === "run_next") {
    return "Fallback answer: prioritize WOs with the strongest mix of due urgency, material coverage, and shared-family sequencing opportunity.";
  }
  if (activeMode === "diagnose" || q.includes("diagnose")) {
    return "Fallback answer: read the current story through four lenses first: output pace, shortage pressure, queue pressure, and data confidence.";
  }
  if (activeMode === "recommend" || q.includes("recommend")) {
    return "Fallback answer: choose the smallest set of actions that protects output, reduces risk, and avoids unnecessary resequencing.";
  }
  if (activeMode === "simulate" || q.includes("what if") || q.includes("scenario")) {
    return "Fallback answer: compare three what-if paths: resolve the top shortage, run the strongest batch family, or recover the biggest throughput loss.";
  }
  if (activeMode === "ideate" || q.includes("brainstorm") || q.includes("ideate")) {
    return "Fallback answer: generate ideas around batching, shortage triage, and daily decision rituals, then test them against current risks before acting.";
  }
  if (q.includes("batch") || q.includes("changeover") || activeMode === "batch_plan") {
    return "Fallback answer: group open work orders by repeated SKU families, then pull the earliest due date to the front inside each family.";
  }
  if (q.includes("risk") || q.includes("short") || activeMode === "risk_radar") {
    return "Fallback answer: start with shortages that carry the largest units-at-risk and nearest due dates, then split missing vs unscheduled inbound.";
  }
  if (q.includes("production") || q.includes("yield") || q.includes("operations") || activeMode === "throughput_watch") {
    return "Fallback answer: compare output pace against yesterday and last week, then isolate unplanned stops, speed loss, and the line or shift most responsible.";
  }
  if (q.includes("revenue") || q.includes("labor")) {
    return "Fallback answer: compare output, revenue coverage, and labor cost inside the same time window, then isolate which lines or SKUs move the result.";
  }
  if (q.includes("delivery") || q.includes("inbound") || q.includes("dock")) {
    return "Fallback answer: anchor to scheduled inbound first, then separate unscheduled or unmatched loads so the team can route ownership quickly.";
  }
  return "Fallback answer for " + context + ": I can summarize this view, explain what changed, and recommend next actions.";
}

function buildIntroMessage(activeView) {
  return {
    role: "assistant",
    text: introByView(activeView),
    meta: {
      modeLabel: "Copilot Ready",
      sourceLabel: "Current view context",
      deterministic: true,
    },
    followUps: [],
  };
}

function suggestionSet(activeView) {
  if (activeView === "workorders") {
    return [
      {
        label: "Run Next",
        tag: "Dispatch",
        mode: "run_next",
        prompt: "What should we run next and why?",
        description: "Rank the next best work orders with sequencing logic."
      },
      {
        label: "Batch Plan",
        tag: "Changeovers",
        mode: "batch_plan",
        prompt: "Where are the best batching opportunities?",
        description: "Find same-item families that can reduce changeovers."
      },
      {
        label: "Standup Brief",
        tag: "Shift pulse",
        mode: "standup",
        prompt: "Write a standup brief with output, risk, and actions.",
        description: "Turn the queue into a short standup-ready narrative."
      }
    ];
  }
  if (activeView === "supplyrisk") {
    return [
      {
        label: "Risk Radar",
        tag: "Shortages",
        mode: "risk_radar",
        prompt: "Which shortages are most urgent today?",
        description: "Focus on what can derail the plan and what to do first."
      },
      {
        label: "Supply Actions",
        tag: "Owners",
        mode: "risk_radar",
        prompt: "What should supply chain do first?",
        description: "Convert the risk watchlist into owner-specific moves."
      },
      {
        label: "Coverage Gaps",
        tag: "Inbound",
        mode: "risk_radar",
        prompt: "What is missing vs unscheduled?",
        description: "Separate true shortages from inbound scheduling misses."
      }
    ];
  }
  if (activeView === "operations") {
    return [
      {
        label: "Throughput Watch",
        tag: "Recovery",
        mode: "throughput_watch",
        prompt: "Create a throughput watch with output pace, loss watch, and recovery moves.",
        description: "Frame the day around pace, stops, and next interventions."
      },
      {
        label: "Shift Handoff",
        tag: "Floor",
        mode: "standup",
        prompt: "Write a shift handoff note with output, risks, and what the next shift should protect.",
        description: "Summarize what the floor needs to know next."
      },
      {
        label: "What Changed",
        tag: "Trend",
        mode: "what_changed",
        prompt: "What changed vs last week?",
        description: "Compare the current pace to the prior week and explain it."
      }
    ];
  }
  if (activeView === "aicopilot") {
    return [
      {
        label: "Diagnose",
        tag: "Analyst",
        mode: "diagnose",
        prompt: "Diagnose what is going on in the operation right now.",
        description: "Interpret the current story before deciding what to do."
      },
      {
        label: "Recommend",
        tag: "Decision",
        mode: "recommend",
        prompt: "Recommend the best next moves from the current operational data.",
        description: "Turn the evidence into actions and tradeoffs."
      },
      {
        label: "Simulate",
        tag: "Scenarios",
        mode: "simulate",
        prompt: "Simulate the most useful what-if scenarios from the current operation.",
        description: "Model shortage, sequencing, and throughput paths."
      },
      {
        label: "Ideate",
        tag: "Explore",
        mode: "ideate",
        prompt: "Ideate grounded ways to improve flow, sequencing, and risk management.",
        description: "Generate practical ideas without pretending they are already validated."
      },
      {
        label: "Standup Brief",
        tag: "Shift pulse",
        mode: "standup",
        prompt: "Write a standup brief with output, risk, and actions.",
        description: "The fastest floor-ready summary from current context."
      },
      {
        label: "Executive Brief",
        tag: "Leadership",
        mode: "executive_brief",
        prompt: "Create a concise executive brief for plant leadership.",
        description: "A tighter recap for managers and escalations."
      },
      {
        label: "Explain Change",
        tag: "Delta",
        mode: "explain_change",
        prompt: "Explain what changed versus last week and what is driving it.",
        description: "Interpret the delta, not just the current snapshot."
      }
    ];
  }
  return [
    {
      label: "Summarize View",
      tag: "Overview",
      mode: "",
      prompt: "Summarize this dashboard in 5 bullets.",
      description: "Condense the current view into a short readable brief."
    },
    {
      label: "Top Actions",
      tag: "Action plan",
      mode: "",
      prompt: "What are top 3 actions for today?",
      description: "Pull out the next moves from the current context."
    },
    {
      label: "What Changed",
      tag: "Trend",
      mode: "what_changed",
      prompt: "What changed since last review?",
      description: "Explain how the current picture differs from before."
    }
  ];
}

function renderMetaTimestamp(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var parsed = new Date(raw);
  if (isNaN(parsed)) return raw;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export default function AskAiPanel(props) {
  var open = !!props.open;
  var onClose = props.onClose;
  var activeView = props.activeView || "workorders";
  var contextLines = Array.isArray(props.contextLines) ? props.contextLines : [];
  var metrics = props.metrics && typeof props.metrics === "object" ? props.metrics : {};
  var labelByView = {
    aicopilot: "AI Copilot",
    operations: "Operations",
    workorders: "Work Orders",
    supplyrisk: "Supply Risk",
    sandbox: "Sandbox",
    flags: "Data Flags",
  };

  var viewLabel = labelByView[activeView] || "Current View";
  var [draft, setDraft] = useState("");
  var [sending, setSending] = useState(false);
  var [messages, setMessages] = useState([buildIntroMessage(activeView)]);

  var suggestions = useMemo(function() {
    return suggestionSet(activeView);
  }, [activeView]);

  function resetThread() {
    setMessages([buildIntroMessage(activeView)]);
    setDraft("");
  }

  function renderInline(text) {
    var parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
    return parts.map(function(part, idx) {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return <strong key={idx}>{part.slice(2, -2)}</strong>;
      }
      return <Fragment key={idx}>{part}</Fragment>;
    });
  }

  function renderAssistantText(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var blocks = [];
    var listType = "";
    var listItems = [];
    var paragraph = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      blocks.push({
        type: "p",
        text: paragraph.join(" ").trim(),
      });
      paragraph = [];
    }

    function flushList() {
      if (!listItems.length) return;
      blocks.push({
        type: listType || "ul",
        items: listItems.slice(),
      });
      listItems = [];
      listType = "";
    }

    lines.forEach(function(raw) {
      var line = raw.trim();
      if (!line) {
        flushParagraph();
        flushList();
        return;
      }
      var ul = line.match(/^[-*]\s+(.+)$/);
      var ol = line.match(/^(\d+)\.\s+(.+)$/);
      if (ul) {
        flushParagraph();
        if (listType && listType !== "ul") flushList();
        listType = "ul";
        listItems.push(ul[1]);
        return;
      }
      if (ol) {
        flushParagraph();
        if (listType && listType !== "ol") flushList();
        listType = "ol";
        listItems.push(ol[2]);
        return;
      }
      flushList();
      paragraph.push(line);
    });

    flushParagraph();
    flushList();

    return blocks.map(function(block, idx) {
      if (block.type === "ul") {
        return (
          <ul key={idx} className="my-1 list-disc pl-5 space-y-1">
            {block.items.map(function(item, itemIdx) {
              return <li key={itemIdx}>{renderInline(item)}</li>;
            })}
          </ul>
        );
      }
      if (block.type === "ol") {
        return (
          <ol key={idx} className="my-1 list-decimal pl-5 space-y-1">
            {block.items.map(function(item, itemIdx) {
              return <li key={itemIdx}>{renderInline(item)}</li>;
            })}
          </ol>
        );
      }
      return (
        <p key={idx} className="my-1">
          {renderInline(block.text)}
        </p>
      );
    });
  }

  function sendMessage(text, options) {
    if (sending) return;
    var prompt = (text || draft || "").trim();
    var mode = options && options.mode ? String(options.mode) : "";
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
        copilotMode: mode,
        activeView: activeView,
        contextLines: contextLines,
        metrics: metrics,
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
          return prev.concat([{
            role: "assistant",
            text: answer,
            meta: body && body.meta ? body.meta : null,
            followUps: Array.isArray(body && body.followUps) ? body.followUps : [],
          }]);
        });
      })
      .catch(function(err) {
        var reason = err && err.message ? String(err.message) : "AI route unavailable";
        var fallback = buildPrototypeReply(prompt, viewLabel, mode);
        setMessages(function(prev) {
          return prev.concat([{
            role: "assistant",
            text: fallback + "\n\n(Using fallback: " + reason + ")",
            meta: {
              modeLabel: mode ? mode.replace(/_/g, " ") : "Fallback",
              sourceLabel: "Client fallback",
              deterministic: true,
            },
            followUps: [],
          }]);
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
              <div>
                <div className="text-base font-semibold text-[rgb(var(--foreground))]">Ask AI Copilot</div>
                <div className="mt-0.5 text-xs text-[rgb(var(--muted))]">Mode-driven guidance grounded in current dashboard context.</div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={resetThread}>
                  New Thread
                </Button>
                <Button variant="outline" size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">Live</Badge>
              <Badge variant="info">{viewLabel}</Badge>
              {metrics && metrics.freshDataTotal ? <Badge variant="secondary">Fresh {metrics.freshData || 0}/{metrics.freshDataTotal}</Badge> : null}
            </div>
            {contextLines.length ? (
              <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                {contextLines.slice(0, 4).map(function(line, idx) {
                  return <div key={idx}>• {line}</div>;
                })}
              </div>
            ) : null}
          </div>

          <div className="border-b border-[rgb(var(--border))] px-4 py-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[rgb(var(--muted))]">Copilot Functions</div>
            <div className="grid gap-2">
              {suggestions.map(function(suggestion) {
                return (
                  <button
                    key={suggestion.label + suggestion.prompt}
                    onClick={function() { sendMessage(suggestion.prompt, { mode: suggestion.mode }); }}
                    className="rounded-xl border border-[rgb(var(--border))] bg-white px-3 py-2 text-left transition hover:border-[rgb(var(--accent))] hover:bg-[rgb(var(--surface))]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium text-[rgb(var(--foreground))]">{suggestion.label}</div>
                      <Badge variant="secondary">{suggestion.tag}</Badge>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[rgb(var(--muted))]">{suggestion.description}</div>
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
                    "max-w-[95%] rounded-xl border px-3 py-2 text-[15px] leading-7 " +
                    (isUser
                      ? "ml-auto border-[rgb(var(--accent))] bg-[rgba(var(--accent-rgb),0.08)] text-[rgb(var(--foreground))]"
                      : "mr-auto border-[rgb(var(--border))] bg-white text-[rgb(var(--foreground))]")
                  }
                >
                  {isUser ? m.text : renderAssistantText(m.text)}
                  {!isUser && (m.meta || (Array.isArray(m.followUps) && m.followUps.length)) ? (
                    <div className="mt-3 border-t border-[rgb(var(--border))] pt-2">
                      {m.meta ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[rgb(var(--muted))]">
                          {m.meta.modeLabel ? <Badge variant={m.meta.deterministic ? "success" : "info"}>{m.meta.modeLabel}</Badge> : null}
                          {m.meta.provider ? <Badge variant="secondary">{m.meta.provider}</Badge> : null}
                          {m.meta.sourceLabel ? <span>{m.meta.sourceLabel}</span> : null}
                          {m.meta.dataTimestamp ? <span>{renderMetaTimestamp(m.meta.dataTimestamp)}</span> : null}
                        </div>
                      ) : null}
                      {m.meta && m.meta.analysisSummary ? (
                        <div className="mt-2 text-xs leading-5 text-[rgb(var(--muted))]">{m.meta.analysisSummary}</div>
                      ) : null}
                      {m.meta && m.meta.toolsUsed && m.meta.toolsUsed.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.meta.toolsUsed.map(function(tool) {
                            return <Badge key={tool} variant="secondary">{tool}</Badge>;
                          })}
                        </div>
                      ) : null}
                      {Array.isArray(m.followUps) && m.followUps.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.followUps.map(function(followUp) {
                            return (
                              <button
                                key={followUp}
                                type="button"
                                onClick={function() { sendMessage(followUp, { mode: m.meta && m.meta.mode ? m.meta.mode : "" }); }}
                                className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2.5 py-1 text-[11px] text-[rgb(var(--foreground))] transition hover:border-[rgb(var(--accent))] hover:text-[rgb(var(--accent))]"
                              >
                                {followUp}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
