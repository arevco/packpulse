import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import PalletPatternBuilder from "./sandbox/PalletPatternBuilder";

export default function SandboxView() {
  const { C, sans } = useTheme();
  const { pill } = useStyles();

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

  return (
    <div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.bright, marginBottom:4 }}>Sandbox</div>
        <div style={{ fontSize:13, color:C.dim }}>Experimental tools and product ideas under development.</div>
      </div>

      <PalletPatternBuilder />

      <div style={{ fontSize:12, color:C.dim, fontWeight:700, letterSpacing:0.2, marginBottom:8 }}>Tool Pipeline</div>
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
    </div>
  );
}
