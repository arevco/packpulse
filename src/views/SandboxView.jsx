import { useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import PalletPatternBuilder from "./sandbox/PalletPatternBuilder";
import LineCardGenerator from "./sandbox/LineCardGenerator";

export default function SandboxView() {
  const { C, sans } = useTheme();
  const { pill } = useStyles();
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
    if (status === "Prototype") return Object.assign({}, pill(false), { color:C.accent, borderColor:C.accentLine, background:C.accentSoft });
    if (status === "Idea") return Object.assign({}, pill(false), { color:C.warn, borderColor:C.warnLine, background:C.warnSoft });
    return Object.assign({}, pill(false), { color:C.dim });
  };

  const sectionHeader = function(title, isOpen, onToggle) {
    return (
      <button
        onClick={onToggle}
        style={{
          width:"100%",
          display:"flex",
          alignItems:"center",
          justifyContent:"space-between",
          gap:8,
          padding:"8px 10px",
          border:"1px solid "+C.border,
          borderRadius:8,
          background:C.surface,
          cursor:"pointer",
          marginBottom:8,
          textAlign:"left"
        }}
      >
        <span style={{ fontSize:13, fontWeight:700, color:C.bright, fontFamily:sans }}>{title}</span>
        <span style={{ fontSize:13, color:C.dim, fontFamily:sans }}>{isOpen ? "▼" : "▶"}</span>
      </button>
    );
  };

  return (
    <div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.bright, marginBottom:4 }}>Sandbox</div>
        <div style={{ fontSize:13, color:C.dim }}>Experimental tools and product ideas under development.</div>
      </div>

      {sectionHeader("Palletizing Pattern Builder", showPalletTool, function() { setShowPalletTool(function(v) { return !v; }); })}
      {showPalletTool && <PalletPatternBuilder />}

      {sectionHeader("Line Card Generator + Repository", showLineCardTool, function() { setShowLineCardTool(function(v) { return !v; }); })}
      {showLineCardTool && <LineCardGenerator />}

      {sectionHeader("Tool Pipeline", showPipeline, function() { setShowPipeline(function(v) { return !v; }); })}
      {showPipeline && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:12 }}>
          {experiments.map(function(exp) {
            return (
              <div key={exp.name} style={{ border:"1px solid "+C.border, borderRadius:8, background:C.surface, padding:14 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:C.bright, fontFamily:sans }}>{exp.name}</div>
                  <span style={statusPill(exp.status)}>{exp.status}</span>
                </div>
                <div style={{ fontSize:13, color:C.dim, lineHeight:1.4 }}>{exp.note}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
