import { useMemo, useState, useEffect } from "react";
import { useTheme } from "../../theme";
import { useStyles } from "../../hooks/useStyles";

const LIBRARY_KEY = "pp-pallet-pattern-library-v1";

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

function clampPositive(value, fallback) {
  var n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function clampPositiveInt(value, fallback) {
  return Math.round(clampPositive(value, fallback));
}

function buildRowCounts(casesPerLayer, rows, cols) {
  var remaining = casesPerLayer;
  var out = [];
  for (var r = 0; r < rows; r++) {
    if (remaining <= 0) out.push(0);
    else {
      var leftRows = rows - r;
      var suggested = Math.ceil(remaining / leftRows);
      var take = Math.min(cols, suggested, remaining);
      out.push(take);
      remaining -= take;
    }
  }
  return out;
}

function calculateFootprint(rowCounts, rotateEveryRow, caseLength, caseWidth) {
  var usedLength = 0;
  var usedWidth = 0;
  rowCounts.forEach(function(count, rowIdx) {
    if (count <= 0) return;
    var rowDirLong = rotateEveryRow ? rowIdx % 2 === 0 : true;
    var lenPerCase = rowDirLong ? caseLength : caseWidth;
    var depth = rowDirLong ? caseWidth : caseLength;
    var rowLen = count * lenPerCase;
    if (rowLen > usedLength) usedLength = rowLen;
    usedWidth += depth;
  });
  return { usedLength: usedLength, usedWidth: usedWidth };
}

function scoreCandidate(candidate) {
  var stability = 58;
  if (candidate.interlocked) stability += 18;
  if (candidate.rotateEveryRow) stability += 10;
  stability += Math.max(0, 10 - Math.abs(candidate.cols - candidate.rows) * 2);
  stability -= candidate.emptySlots * 4;
  stability = Math.max(1, Math.min(100, Math.round(stability)));

  var cubeUtilization = Math.max(0, Math.min(100, Math.round((candidate.casesPerLayer / (candidate.rows * candidate.cols)) * 100)));
  var throughput = Math.round((candidate.casesPerLayer * candidate.layersTall) / Math.max(1, candidate.layersTall) * 10) / 10;
  var totalScore = Math.round(stability * 0.6 + cubeUtilization * 0.4);
  return { stability: stability, cubeUtilization: cubeUtilization, throughput: throughput, totalScore: totalScore };
}

function formatDateTime(ts) {
  if (!ts) return "--";
  var d = new Date(ts);
  if (isNaN(d)) return "--";
  return d.toLocaleString();
}

export default function PalletPatternBuilder() {
  const { C, sans, mono } = useTheme();
  const { inp, sel, pill } = useStyles();

  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const selectedPreset = useMemo(function() { return PRESETS.find(function(p) { return p.id === presetId; }) || PRESETS[0]; }, [presetId]);

  const [productName, setProductName] = useState(selectedPreset.product);
  const [casesPerLayer, setCasesPerLayer] = useState(selectedPreset.casesPerLayer);
  const [layersTall, setLayersTall] = useState(selectedPreset.layersTall);
  const [rotateEveryRow, setRotateEveryRow] = useState(selectedPreset.rotateEveryRow);
  const [interlocked, setInterlocked] = useState(selectedPreset.interlocked);
  const [notes, setNotes] = useState(selectedPreset.notes || "");
  const [gridRows, setGridRows] = useState(4);
  const [gridCols, setGridCols] = useState(4);
  const [options, setOptions] = useState([]);

  const [palletLength, setPalletLength] = useState(48);
  const [palletWidth, setPalletWidth] = useState(40);
  const [caseLength, setCaseLength] = useState(16);
  const [caseWidth, setCaseWidth] = useState(12);
  const [caseHeight, setCaseHeight] = useState(8);
  const [caseWeight, setCaseWeight] = useState(6);
  const [maxHeight, setMaxHeight] = useState(72);
  const [maxWeight, setMaxWeight] = useState(2200);

  const [libraryName, setLibraryName] = useState("");
  const [savedPatterns, setSavedPatterns] = useState([]);
  const [selectedSavedId, setSelectedSavedId] = useState("");

  const cpl = clampPositiveInt(casesPerLayer, selectedPreset.casesPerLayer);
  const layers = clampPositiveInt(layersTall, selectedPreset.layersTall);
  const rows = Math.max(1, clampPositiveInt(gridRows, 4));
  const cols = Math.max(1, clampPositiveInt(gridCols, 4));
  const rowCounts = useMemo(function() { return buildRowCounts(cpl, rows, cols); }, [cpl, rows, cols]);
  const totalCases = cpl * layers;
  const emptySlots = Math.max(0, rows * cols - cpl);

  const footprint = useMemo(function() {
    return calculateFootprint(rowCounts, rotateEveryRow, clampPositive(caseLength, 16), clampPositive(caseWidth, 12));
  }, [rowCounts, rotateEveryRow, caseLength, caseWidth]);

  const stackHeight = layers * clampPositive(caseHeight, 8);
  const stackWeight = totalCases * clampPositive(caseWeight, 6);
  const hasOverhang = footprint.usedLength > clampPositive(palletLength, 48) || footprint.usedWidth > clampPositive(palletWidth, 40);
  const constraints = [
    { label:"Max Height", pass:stackHeight <= clampPositive(maxHeight, 72), detail:Math.round(stackHeight) + " in / " + clampPositive(maxHeight, 72) + " in" },
    { label:"Max Weight", pass:stackWeight <= clampPositive(maxWeight, 2200), detail:Math.round(stackWeight).toLocaleString() + " lb / " + clampPositive(maxWeight, 2200).toLocaleString() + " lb" },
    { label:"Pallet Footprint", pass:!hasOverhang, detail:Math.round(footprint.usedLength) + "x" + Math.round(footprint.usedWidth) + " in on " + clampPositive(palletLength, 48) + "x" + clampPositive(palletWidth, 40) + " pallet" },
    { label:"Interlock Policy", pass:interlocked, detail:interlocked ? "Enabled" : "Disabled" }
  ];

  const layerPattern = Array.from({ length:layers }).map(function(_, layerIdx) {
    return { idx: layerIdx + 1, dir: rotateEveryRow ? (layerIdx % 2 === 0 ? "L" : "W") : "L", offset: interlocked && layerIdx % 2 === 1 ? 10 : 0 };
  });

  const activeScore = scoreCandidate({
    casesPerLayer: cpl,
    layersTall: layers,
    rows: rows,
    cols: cols,
    rotateEveryRow: rotateEveryRow,
    interlocked: interlocked,
    emptySlots: emptySlots
  });

  const applyPreset = function(nextId) {
    var p = PRESETS.find(function(x) { return x.id === nextId; });
    setPresetId(nextId);
    if (!p) return;
    setProductName(p.product);
    setCasesPerLayer(p.casesPerLayer);
    setLayersTall(p.layersTall);
    setRotateEveryRow(!!p.rotateEveryRow);
    setInterlocked(!!p.interlocked);
    setNotes(p.notes || "");
    setGridRows(Math.max(1, Math.floor(Math.sqrt(p.casesPerLayer))));
    setGridCols(Math.max(1, Math.ceil(p.casesPerLayer / Math.max(1, Math.floor(Math.sqrt(p.casesPerLayer))))));
  };

  const generateOptions = function() {
    var out = [];
    for (var r = 1; r <= Math.min(10, cpl); r++) {
      var c = Math.ceil(cpl / r);
      if (c > 14) continue;
      [true, false].forEach(function(rot) {
        [true, false].forEach(function(il) {
          var candidate = { rows:r, cols:c, rotateEveryRow:rot, interlocked:il, casesPerLayer:cpl, layersTall:layers, emptySlots:Math.max(0, r * c - cpl) };
          var score = scoreCandidate(candidate);
          out.push(Object.assign({}, candidate, score));
        });
      });
    }
    out.sort(function(a, b) { return b.totalScore - a.totalScore; });
    setOptions(out.slice(0, 6));
  };

  const applyOption = function(opt) {
    setGridRows(opt.rows);
    setGridCols(opt.cols);
    setRotateEveryRow(opt.rotateEveryRow);
    setInterlocked(opt.interlocked);
  };

  useEffect(function() {
    try {
      var raw = window.localStorage.getItem(LIBRARY_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setSavedPatterns(parsed);
    } catch (e) {
      setSavedPatterns([]);
    }
  }, []);

  const persistLibrary = function(next) {
    setSavedPatterns(next);
    try { window.localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  };

  const snapshotCurrent = function() {
    return {
      productName: productName,
      casesPerLayer: cpl,
      layersTall: layers,
      rotateEveryRow: rotateEveryRow,
      interlocked: interlocked,
      notes: notes,
      gridRows: rows,
      gridCols: cols,
      palletLength: clampPositive(palletLength, 48),
      palletWidth: clampPositive(palletWidth, 40),
      caseLength: clampPositive(caseLength, 16),
      caseWidth: clampPositive(caseWidth, 12),
      caseHeight: clampPositive(caseHeight, 8),
      caseWeight: clampPositive(caseWeight, 6),
      maxHeight: clampPositive(maxHeight, 72),
      maxWeight: clampPositive(maxWeight, 2200)
    };
  };

  const savePattern = function() {
    var name = String(libraryName || productName || "Untitled Pattern").trim();
    if (!name) return;
    var id = Date.now().toString(36);
    var next = [{ id:id, name:name, updatedAt:new Date().toISOString(), data:snapshotCurrent() }].concat(savedPatterns).slice(0, 100);
    persistLibrary(next);
    setLibraryName("");
    setSelectedSavedId(id);
  };

  const loadPattern = function(id) {
    setSelectedSavedId(id);
    var found = savedPatterns.find(function(p) { return p.id === id; });
    if (!found || !found.data) return;
    var d = found.data;
    setProductName(d.productName || "");
    setCasesPerLayer(d.casesPerLayer || 1);
    setLayersTall(d.layersTall || 1);
    setRotateEveryRow(!!d.rotateEveryRow);
    setInterlocked(!!d.interlocked);
    setNotes(d.notes || "");
    setGridRows(d.gridRows || 1);
    setGridCols(d.gridCols || 1);
    setPalletLength(d.palletLength || 48);
    setPalletWidth(d.palletWidth || 40);
    setCaseLength(d.caseLength || 16);
    setCaseWidth(d.caseWidth || 12);
    setCaseHeight(d.caseHeight || 8);
    setCaseWeight(d.caseWeight || 6);
    setMaxHeight(d.maxHeight || 72);
    setMaxWeight(d.maxWeight || 2200);
  };

  const deleteSelectedPattern = function() {
    if (!selectedSavedId) return;
    var next = savedPatterns.filter(function(p) { return p.id !== selectedSavedId; });
    persistLibrary(next);
    setSelectedSavedId("");
  };

  const exportOnePager = function() {
    var win = window.open("", "_blank", "width=980,height=760");
    if (!win) return;
    var html = [
      "<!doctype html><html><head><title>Pallet Pattern - ", productName, "</title>",
      "<style>body{font-family:Arial,sans-serif;padding:20px;color:#222}h1{margin:0 0 6px}h2{margin:18px 0 8px;font-size:16px}table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}th{background:#f6f7f9}.pass{color:#1b8f4f;font-weight:700}.fail{color:#cc3838;font-weight:700}.mono{font-family:ui-monospace,monospace}</style>",
      "</head><body>",
      "<h1>", productName, " - Pallet Pattern</h1>",
      "<div>Generated: ", new Date().toLocaleString(), "</div>",
      "<h2>Pattern</h2>",
      "<table><tr><th>Cases/Layer</th><th>Layers</th><th>Total Cases</th><th>Grid</th><th>Rotate</th><th>Interlocked</th></tr>",
      "<tr><td>", cpl, "</td><td>", layers, "</td><td>", totalCases, "</td><td class='mono'>", rows, " x ", cols, "</td><td>", rotateEveryRow ? "Yes" : "No", "</td><td>", interlocked ? "Yes" : "No", "</td></tr></table>",
      "<h2>Constraint Checks</h2>",
      "<table><tr><th>Check</th><th>Status</th><th>Detail</th></tr>",
      constraints.map(function(ch) { return "<tr><td>" + ch.label + "</td><td class='" + (ch.pass ? "pass" : "fail") + "'>" + (ch.pass ? "PASS" : "FAIL") + "</td><td>" + ch.detail + "</td></tr>"; }).join(""),
      "</table>",
      "<h2>Notes</h2><div>", (notes || "--"), "</div>",
      "</body></html>"
    ].join("");
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(function() { win.print(); }, 250);
  };

  return (
    <div style={{ border:"1px solid " + C.border, borderRadius:10, background:C.surface, padding:14, marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:16, fontWeight:700, color:C.bright }}>Palletizing Pattern Builder</div>
          <div style={{ fontSize:13, color:C.dim }}>Generate options, run constraints, and save approved patterns.</div>
        </div>
        <span style={Object.assign({}, pill(false), { color:C.accent, borderColor:C.accentLine, background:C.accentSoft })}>Sandbox Tool</span>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:10, marginBottom:10 }}>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Preset</span>
          <select value={presetId} onChange={function(e) { applyPreset(e.target.value); }} style={sel}>
            {PRESETS.map(function(p) { return <option key={p.id} value={p.id}>{p.product}</option>; })}
          </select>
        </label>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Product Name</span>
          <input value={productName} onChange={function(e) { setProductName(e.target.value); }} style={inp} />
        </label>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Cases / Layer</span>
          <input type="number" min={1} step={1} value={casesPerLayer} onChange={function(e) { setCasesPerLayer(e.target.value); }} style={inp} />
        </label>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Layers Tall</span>
          <input type="number" min={1} step={1} value={layersTall} onChange={function(e) { setLayersTall(e.target.value); }} style={inp} />
        </label>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Grid Rows</span>
          <input type="number" min={1} step={1} value={gridRows} onChange={function(e) { setGridRows(e.target.value); }} style={inp} />
        </label>
        <label style={{ display:"grid", gap:6 }}>
          <span style={{ fontSize:12, color:C.dim, fontWeight:600 }}>Grid Cols</span>
          <input type="number" min={1} step={1} value={gridCols} onChange={function(e) { setGridCols(e.target.value); }} style={inp} />
        </label>
      </div>

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <button onClick={function() { setRotateEveryRow(function(v) { return !v; }); }} style={pill(rotateEveryRow)}>Rotate Every Row</button>
        <button onClick={function() { setInterlocked(function(v) { return !v; }); }} style={pill(interlocked)}>Interlocked</button>
        <button onClick={generateOptions} style={Object.assign({}, pill(false), { color:C.bright, borderColor:C.border, background:C.raised })}>Generate Options</button>
        <button onClick={exportOnePager} style={Object.assign({}, pill(false), { color:C.bright, borderColor:C.border, background:C.raised })}>Export One-Pager</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"minmax(240px, 1fr) minmax(320px, 2fr)", gap:12, marginBottom:12 }}>
        <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:12 }}>
          <div style={{ fontSize:12, color:C.dim, marginBottom:8, fontWeight:600, letterSpacing:0.2 }}>Pattern Summary</div>
          <div style={{ fontSize:13, color:C.text, lineHeight:1.5 }}>
            <div><strong style={{ color:C.bright }}>{cpl.toLocaleString()}</strong> cases/layer</div>
            <div><strong style={{ color:C.bright }}>{layers.toLocaleString()}</strong> layers tall</div>
            <div><strong style={{ color:C.accent }}>{totalCases.toLocaleString()}</strong> total cases/pallet</div>
            <div style={{ marginTop:6 }}>Grid: <span style={{ fontFamily:mono, color:C.bright }}>{rows} x {cols}</span> (empty slots: {emptySlots})</div>
            <div>Score: <span style={{ color:C.bright, fontWeight:700 }}>{activeScore.totalScore}</span> | Stability {activeScore.stability} | Cube {activeScore.cubeUtilization}%</div>
          </div>
          <div style={{ marginTop:10, fontSize:12, color:C.dim }}>
            <div style={{ fontWeight:600, marginBottom:4 }}>Notes</div>
            <textarea value={notes} onChange={function(e) { setNotes(e.target.value); }} style={{ width:"100%", minHeight:86, resize:"vertical", border:"1px solid " + C.border, borderRadius:6, padding:"8px 10px", fontFamily:sans, fontSize:12, color:C.text, background:C.surface }} />
          </div>
        </div>

        <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:12 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:12 }}>
            <div>
              <div style={{ fontSize:12, color:C.dim, fontWeight:600, letterSpacing:0.2, marginBottom:8 }}>Top View</div>
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
                            <span key={i} style={{ width:longDir ? 18 : 12, height:longDir ? 12 : 18, borderRadius:2, background:longDir ? C.accentSoft : C.okSoft, border:"1px solid " + (longDir ? C.accentLine : C.okLine), display:"inline-block" }} />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <div style={{ fontSize:12, color:C.dim, fontWeight:600, letterSpacing:0.2, marginBottom:8 }}>Side View</div>
              <div style={{ border:"1px dashed " + C.border, borderRadius:6, padding:8, background:C.surface }}>
                <div style={{ display:"grid", gap:4 }}>
                  {layerPattern.slice().reverse().map(function(layer) {
                    var isLong = layer.dir === "L";
                    return (
                      <div key={layer.idx} style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ width:24, fontFamily:mono, fontSize:11, color:C.dim, textAlign:"right" }}>L{layer.idx}</span>
                        <span style={{ width:(isLong ? 132 : 112) + layer.offset, height:10, borderRadius:4, background:isLong ? C.accentSoft : C.okSoft, border:"1px solid " + (isLong ? C.accentLine : C.okLine), display:"inline-block" }} />
                        <span style={{ fontSize:11, color:C.dim, fontFamily:mono }}>{cpl}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:12, marginBottom:12 }}>
        <div style={{ fontSize:12, color:C.dim, fontWeight:600, letterSpacing:0.2, marginBottom:8 }}>Constraint Checks</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))", gap:10, marginBottom:10 }}>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Pallet L (in)</span><input type="number" value={palletLength} onChange={function(e) { setPalletLength(e.target.value); }} style={inp} /></label>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Pallet W (in)</span><input type="number" value={palletWidth} onChange={function(e) { setPalletWidth(e.target.value); }} style={inp} /></label>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Case L (in)</span><input type="number" value={caseLength} onChange={function(e) { setCaseLength(e.target.value); }} style={inp} /></label>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Case W (in)</span><input type="number" value={caseWidth} onChange={function(e) { setCaseWidth(e.target.value); }} style={inp} /></label>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Case H (in)</span><input type="number" value={caseHeight} onChange={function(e) { setCaseHeight(e.target.value); }} style={inp} /></label>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Case Weight (lb)</span><input type="number" value={caseWeight} onChange={function(e) { setCaseWeight(e.target.value); }} style={inp} /></label>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Max Height (in)</span><input type="number" value={maxHeight} onChange={function(e) { setMaxHeight(e.target.value); }} style={inp} /></label>
          <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Max Weight (lb)</span><input type="number" value={maxWeight} onChange={function(e) { setMaxWeight(e.target.value); }} style={inp} /></label>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:8 }}>
          {constraints.map(function(ch) {
            return (
              <div key={ch.label} style={{ border:"1px solid " + C.border, borderRadius:6, padding:"8px 10px", background:C.surface }}>
                <div style={{ fontSize:12, color:C.dim, marginBottom:2 }}>{ch.label}</div>
                <div style={{ fontSize:13, fontWeight:700, color:ch.pass ? C.ok : C.bad }}>{ch.pass ? "PASS" : "FAIL"}</div>
                <div style={{ fontSize:12, color:C.text }}>{ch.detail}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:12, marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:8, flexWrap:"wrap" }}>
          <div style={{ fontSize:12, color:C.dim, fontWeight:600, letterSpacing:0.2 }}>Auto-Generated Options</div>
          <div style={{ fontSize:12, color:C.dim }}>Ranked by stability + cube utilization</div>
        </div>
        {options.length === 0 ? (
          <div style={{ fontSize:13, color:C.dim }}>Click <strong>Generate Options</strong> to create alternate patterns.</div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:8 }}>
            {options.map(function(opt, idx) {
              return (
                <button key={idx} onClick={function() { applyOption(opt); }} style={{ textAlign:"left", border:"1px solid " + C.border, borderRadius:6, background:C.surface, padding:"8px 10px", cursor:"pointer" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:C.bright, marginBottom:2 }}>Option {idx + 1}: {opt.rows}x{opt.cols}</div>
                  <div style={{ fontSize:12, color:C.dim }}>Score {opt.totalScore} | Stability {opt.stability} | Cube {opt.cubeUtilization}%</div>
                  <div style={{ fontSize:12, color:C.text }}>{opt.rotateEveryRow ? "Rotate" : "Fixed"} | {opt.interlocked ? "Interlocked" : "No interlock"} | Empty {opt.emptySlots}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:12 }}>
        <div style={{ fontSize:12, color:C.dim, fontWeight:600, letterSpacing:0.2, marginBottom:8 }}>Pattern Library (Local)</div>
        <div style={{ display:"grid", gridTemplateColumns:"minmax(180px, 1fr) minmax(220px, 1fr) auto auto", gap:8, alignItems:"end", marginBottom:8 }}>
          <label style={{ display:"grid", gap:4 }}>
            <span style={{ fontSize:11, color:C.dim }}>Save Name</span>
            <input value={libraryName} onChange={function(e) { setLibraryName(e.target.value); }} style={inp} placeholder="Monster 15/16 Rev A" />
          </label>
          <label style={{ display:"grid", gap:4 }}>
            <span style={{ fontSize:11, color:C.dim }}>Saved Patterns</span>
            <select value={selectedSavedId} onChange={function(e) { loadPattern(e.target.value); }} style={sel}>
              <option value="">Select saved pattern</option>
              {savedPatterns.map(function(p) { return <option key={p.id} value={p.id}>{p.name} - {formatDateTime(p.updatedAt)}</option>; })}
            </select>
          </label>
          <button onClick={savePattern} style={Object.assign({}, pill(false), { height:34, color:C.bright, borderColor:C.border, background:C.surface })}>Save Current</button>
          <button onClick={deleteSelectedPattern} style={Object.assign({}, pill(false), { height:34, color:C.bad, borderColor:C.badLine, background:C.badSoft })}>Delete</button>
        </div>
        <div style={{ fontSize:12, color:C.dim }}>{savedPatterns.length} patterns saved in this browser.</div>
      </div>
    </div>
  );
}
