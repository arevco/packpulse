import { useMemo, useState } from "react";
import { useTheme } from "../../theme";
import { useStyles } from "../../hooks/useStyles";

const PRESETS = [
  { id:"general-104", product:"General / Common (Rotating)", casesPerLayer:13, layersTall:8, rotateEveryRow:true, interlocked:false, notes:"104 cases total. Rotates every row." },
  { id:"celsius-revised", product:"Celsius (Revised)", casesPerLayer:13, layersTall:8, rotateEveryRow:true, interlocked:true, notes:"Approved. Must be interlocked." },
  { id:"monster-15-16", product:"Monster 15/16 oz.", casesPerLayer:20, layersTall:7, rotateEveryRow:true, interlocked:false, notes:"Original quoted pattern." },
  { id:"monster-24-16", product:"Monster 24/16 oz.", casesPerLayer:10, layersTall:7, rotateEveryRow:true, interlocked:false, notes:"Original quoted pattern." },
  { id:"joy-burst", product:"Joy Burst", casesPerLayer:26, layersTall:8, rotateEveryRow:true, interlocked:false, notes:"208 total per pallet." },
  { id:"joy-burst-sleek", product:"Joy Burst 12 oz. Sleek", casesPerLayer:13, layersTall:8, rotateEveryRow:true, interlocked:false, notes:"Center case pulls back on one end of the 40-inch side." },
  { id:"soul-boost", product:"Soul Boost", casesPerLayer:10, layersTall:10, rotateEveryRow:true, interlocked:false, notes:"Soul Boost-alt exists and may be preferred by ABC Packaging." },
  { id:"arizona-24-16", product:"Arizona 24/16 oz.", casesPerLayer:13, layersTall:8, rotateEveryRow:true, interlocked:false, notes:"Center case pulls back to the middle on one end of the 40-inch side." },
  { id:"malta-goyo", product:"Malta Goyo 2/12 packs", casesPerLayer:12, layersTall:6, rotateEveryRow:true, interlocked:false, notes:"72 total per pallet." }
];

function clampPositiveInt(value, fallback) {
  var n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function bestGrid(casesPerLayer) {
  var cpl = Math.max(1, clampPositiveInt(casesPerLayer, 1));
  var targetRatio = 1.2;
  var best = { rows:1, cols:cpl, score:Number.POSITIVE_INFINITY };
  for (var rows = 1; rows <= Math.min(16, cpl); rows++) {
    var cols = Math.ceil(cpl / rows);
    var ratio = cols / rows;
    var emptySlots = rows * cols - cpl;
    var score = Math.abs(ratio - targetRatio) * 10 + emptySlots * 0.8 + Math.abs(cols - rows) * 0.25;
    if (score < best.score) best = { rows:rows, cols:cols, score:score };
  }
  return { rows:best.rows, cols:best.cols };
}

function distributeByRows(total, rows) {
  var out = [];
  var base = Math.floor(total / rows);
  var rem = total % rows;
  for (var i = 0; i < rows; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

export default function PalletPatternBuilder() {
  const { C, sans, mono } = useTheme();
  const { inp, sel, pill } = useStyles();

  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const selectedPreset = useMemo(function() {
    return PRESETS.find(function(p) { return p.id === presetId; }) || PRESETS[0];
  }, [presetId]);

  const [casesPerLayer, setCasesPerLayer] = useState(selectedPreset.casesPerLayer);
  const [layersTall, setLayersTall] = useState(selectedPreset.layersTall);
  const [rotateEveryRow, setRotateEveryRow] = useState(selectedPreset.rotateEveryRow);
  const [interlocked, setInterlocked] = useState(selectedPreset.interlocked);
  const [notes, setNotes] = useState(selectedPreset.notes || "");

  const applyPreset = function(nextId) {
    var p = PRESETS.find(function(x) { return x.id === nextId; });
    setPresetId(nextId);
    if (!p) return;
    setCasesPerLayer(p.casesPerLayer);
    setLayersTall(p.layersTall);
    setRotateEveryRow(!!p.rotateEveryRow);
    setInterlocked(!!p.interlocked);
    setNotes(p.notes || "");
  };

  const cpl = clampPositiveInt(casesPerLayer, selectedPreset.casesPerLayer);
  const layers = clampPositiveInt(layersTall, selectedPreset.layersTall);
  const totalCases = cpl * layers;
  const grid = bestGrid(cpl);
  const rowCounts = distributeByRows(cpl, grid.rows);

  return (
    <div style={{ border:"1px solid " + C.border, borderRadius:10, background:C.surface, padding:14, marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:16, fontWeight:700, color:C.bright }}>Palletizing Pattern Builder</div>
          <div style={{ fontSize:13, color:C.dim }}>Build and preview pallet layer patterns from product specs.</div>
        </div>
        <span style={Object.assign({}, pill(false), { color:C.accent, borderColor:C.accentLine, background:C.accentSoft })}>Sandbox Tool</span>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:10, marginBottom:12 }}>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Preset</span>
          <select value={presetId} onChange={function(e) { applyPreset(e.target.value); }} style={sel}>
            {PRESETS.map(function(p) { return <option key={p.id} value={p.id}>{p.product}</option>; })}
          </select>
        </label>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Cases / Layer</span>
          <input type="number" min={1} step={1} value={casesPerLayer} onChange={function(e) { setCasesPerLayer(e.target.value); }} style={inp} />
        </label>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Layers Tall</span>
          <input type="number" min={1} step={1} value={layersTall} onChange={function(e) { setLayersTall(e.target.value); }} style={inp} />
        </label>
      </div>

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:12 }}>
        <button onClick={function() { setRotateEveryRow(function(v) { return !v; }); }} style={pill(rotateEveryRow)}>Rotate Every Row</button>
        <button onClick={function() { setInterlocked(function(v) { return !v; }); }} style={pill(interlocked)}>Interlocked</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"minmax(240px, 1fr) minmax(320px, 2fr)", gap:12 }}>
        <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:12 }}>
          <div style={{ fontSize:12, color:C.dim, marginBottom:8, fontWeight:600, letterSpacing:0.2 }}>Pattern Summary</div>
          <div style={{ fontSize:13, color:C.text, lineHeight:1.5 }}>
            <div><strong style={{ color:C.bright }}>{cpl.toLocaleString()}</strong> cases/layer</div>
            <div><strong style={{ color:C.bright }}>{layers.toLocaleString()}</strong> layers tall</div>
            <div><strong style={{ color:C.accent }}>{totalCases.toLocaleString()}</strong> total cases/pallet</div>
            <div style={{ marginTop:6 }}>Grid suggestion: <span style={{ fontFamily:mono, color:C.bright }}>{grid.cols} x {grid.rows}</span></div>
            <div>Pattern flags: {rotateEveryRow ? "Rotate rows" : "Fixed rows"} {interlocked ? " + Interlocked" : ""}</div>
          </div>
          <div style={{ marginTop:10, fontSize:12, color:C.dim }}>
            <div style={{ fontWeight:600, marginBottom:4 }}>Notes</div>
            <textarea value={notes} onChange={function(e) { setNotes(e.target.value); }} style={{ width:"100%", minHeight:86, resize:"vertical", border:"1px solid " + C.border, borderRadius:6, padding:"8px 10px", fontFamily:sans, fontSize:12, color:C.text, background:C.surface }} />
          </div>
        </div>

        <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <div style={{ fontSize:12, color:C.dim, fontWeight:600, letterSpacing:0.2 }}>Layer Preview (Top View)</div>
            <div style={{ fontSize:12, color:C.dim }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, marginRight:10 }}>
                <span style={{ width:10, height:10, borderRadius:2, background:C.accentSoft, border:"1px solid " + C.accentLine }} /> L
              </span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
                <span style={{ width:10, height:10, borderRadius:2, background:C.okSoft, border:"1px solid " + C.okLine }} /> W
              </span>
            </div>
          </div>
          <div style={{ display:"grid", gap:6 }}>
            {rowCounts.map(function(count, rowIdx) {
              var rowDir = rotateEveryRow ? (rowIdx % 2 === 0 ? "L" : "W") : "L";
              var offset = interlocked && rowIdx % 2 === 1 ? 16 : 0;
              return (
                <div key={rowIdx} style={{ display:"flex", alignItems:"center", gap:6, marginLeft:offset }}>
                  <span style={{ width:26, fontFamily:mono, fontSize:11, color:C.dim }}>R{rowIdx + 1}</span>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                    {Array.from({ length:count }).map(function(_, i) {
                      var longDir = rowDir === "L";
                      return (
                        <span
                          key={i}
                          title={"Row " + (rowIdx + 1) + " case " + (i + 1)}
                          style={{
                            width:longDir ? 18 : 12,
                            height:longDir ? 12 : 18,
                            borderRadius:2,
                            background:longDir ? C.accentSoft : C.okSoft,
                            border:"1px solid " + (longDir ? C.accentLine : C.okLine),
                            display:"inline-block"
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
