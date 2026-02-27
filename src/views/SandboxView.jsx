import { useState } from "react";
import { useTheme } from "../theme";
import PalletPatternBuilder from "./sandbox/PalletPatternBuilder";
import LineCardGenerator from "./sandbox/LineCardGenerator";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

export default function SandboxView() {
  const { C } = useTheme();
  const [showPalletTool, setShowPalletTool] = useState(true);
  const [showLineCardTool, setShowLineCardTool] = useState(true);
  const [showPipeline, setShowPipeline] = useState(true);

  const experiments = [
    { name: "AI Planner", status: "Idea", note: "Scenario planning for rush orders, substitutions, and labor moves." },
    { name: "Dock Risk Scoring", status: "Prototype", note: "Predict appointment slippage and downstream WO impact." },
    { name: "Supplier Health", status: "Backlog", note: "Lead-time volatility and late-delivery trend by supplier." },
    { name: "Shift Replay", status: "Idea", note: "Replay yesterday's blockers and decisions as a timeline." }
  ];

  const statusPill = function(status) {
    if (status === "Prototype") return "secondary";
    if (status === "Idea") return "warning";
    return "default";
  };

  const sectionHeader = function(title, isOpen, onToggle) {
    return (
      <Button
        onClick={onToggle}
        variant="soft"
        size="default"
        className="mb-2 flex w-full items-center justify-between gap-2 px-2.5 text-left"
      >
        <span className="text-sm font-bold text-[rgb(var(--foreground))]">{title}</span>
        <span className="text-sm text-[rgb(var(--muted))]">{isOpen ? "▼" : "▶"}</span>
      </Button>
    );
  };

  return (
    <div>
      <div className="mb-3">
        <div className="mb-1 text-base font-bold text-[rgb(var(--foreground))]">Sandbox</div>
        <div className="text-sm text-[rgb(var(--muted))]">Experimental tools and product ideas under development.</div>
      </div>

      {sectionHeader("Palletizing Pattern Builder", showPalletTool, function() { setShowPalletTool(function(v) { return !v; }); })}
      {showPalletTool && <PalletPatternBuilder />}

      {sectionHeader("Line Card Generator + Repository", showLineCardTool, function() { setShowLineCardTool(function(v) { return !v; }); })}
      {showLineCardTool && <LineCardGenerator />}

      {sectionHeader("Tool Pipeline", showPipeline, function() { setShowPipeline(function(v) { return !v; }); })}
      {showPipeline && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
          {experiments.map(function(exp) {
            return (
              <div key={exp.name} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-[rgb(var(--foreground))]">{exp.name}</div>
                  <Badge variant={statusPill(exp.status)}>{exp.status}</Badge>
                </div>
                <div className="text-sm leading-[1.4] text-[rgb(var(--muted))]">{exp.note}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
