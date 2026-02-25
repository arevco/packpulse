import { useMemo, useState, useEffect } from "react";
import { useTheme } from "../../theme";
import { useStyles } from "../../hooks/useStyles";

const REPO_KEY = "pp-line-card-repository-v1";

function makeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function newLineCard() {
  return {
    id: makeId(),
    sku: "",
    productName: "",
    customer: "",
    packConfig: "",
    revision: "A",
    line: "",
    owner: "",
    runRateUph: "",
    effectiveDate: "",
    materials: [
      { name: "", spec: "", notes: "" },
      { name: "", spec: "", notes: "" }
    ],
    setupChecklist: [
      { task: "Verify materials staged at line", required: true },
      { task: "Confirm change parts installed", required: true },
      { task: "Run first-article check", required: true }
    ],
    qualityChecks: [
      { check: "Label placement", frequency: "Start + hourly", target: "" },
      { check: "Seal integrity", frequency: "Start + hourly", target: "" },
      { check: "Pack count", frequency: "Each pallet", target: "" }
    ],
    safetyNotes: "",
    changeoverNotes: "",
    troubleshooting: "",
    updatedAt: new Date().toISOString()
  };
}

function fmtTs(ts) {
  if (!ts) return "--";
  var d = new Date(ts);
  return isNaN(d) ? "--" : d.toLocaleString();
}

export default function LineCardGenerator() {
  const { C, sans } = useTheme();
  const { inp, sel, pill } = useStyles();

  const [card, setCard] = useState(newLineCard());
  const [repo, setRepo] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [saveName, setSaveName] = useState("");

  useEffect(function() {
    try {
      var raw = window.localStorage.getItem(REPO_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setRepo(parsed);
    } catch (e) {
      setRepo([]);
    }
  }, []);

  function persist(next) {
    setRepo(next);
    try { window.localStorage.setItem(REPO_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  }

  function patch(fields) {
    setCard(function(prev) { return Object.assign({}, prev, fields, { updatedAt: new Date().toISOString() }); });
  }

  function updateMaterial(idx, field, value) {
    setCard(function(prev) {
      var rows = prev.materials.slice();
      rows[idx] = Object.assign({}, rows[idx], { [field]: value });
      return Object.assign({}, prev, { materials: rows, updatedAt: new Date().toISOString() });
    });
  }

  function updateSetup(idx, field, value) {
    setCard(function(prev) {
      var rows = prev.setupChecklist.slice();
      rows[idx] = Object.assign({}, rows[idx], { [field]: value });
      return Object.assign({}, prev, { setupChecklist: rows, updatedAt: new Date().toISOString() });
    });
  }

  function updateQuality(idx, field, value) {
    setCard(function(prev) {
      var rows = prev.qualityChecks.slice();
      rows[idx] = Object.assign({}, rows[idx], { [field]: value });
      return Object.assign({}, prev, { qualityChecks: rows, updatedAt: new Date().toISOString() });
    });
  }

  function addRow(kind) {
    setCard(function(prev) {
      if (kind === "materials") return Object.assign({}, prev, { materials: prev.materials.concat([{ name: "", spec: "", notes: "" }]), updatedAt: new Date().toISOString() });
      if (kind === "setup") return Object.assign({}, prev, { setupChecklist: prev.setupChecklist.concat([{ task: "", required: true }]), updatedAt: new Date().toISOString() });
      return Object.assign({}, prev, { qualityChecks: prev.qualityChecks.concat([{ check: "", frequency: "", target: "" }]), updatedAt: new Date().toISOString() });
    });
  }

  function removeRow(kind, idx) {
    setCard(function(prev) {
      if (kind === "materials") {
        var nextM = prev.materials.filter(function(_, i) { return i !== idx; });
        return Object.assign({}, prev, { materials: nextM.length ? nextM : [{ name: "", spec: "", notes: "" }], updatedAt: new Date().toISOString() });
      }
      if (kind === "setup") {
        var nextS = prev.setupChecklist.filter(function(_, i) { return i !== idx; });
        return Object.assign({}, prev, { setupChecklist: nextS.length ? nextS : [{ task: "", required: true }], updatedAt: new Date().toISOString() });
      }
      var nextQ = prev.qualityChecks.filter(function(_, i) { return i !== idx; });
      return Object.assign({}, prev, { qualityChecks: nextQ.length ? nextQ : [{ check: "", frequency: "", target: "" }], updatedAt: new Date().toISOString() });
    });
  }

  function saveCurrent() {
    var name = String(saveName || card.productName || card.sku || "Untitled Line Card").trim();
    if (!name) return;
    var snapshot = Object.assign({}, card, { id: card.id || makeId(), savedName: name, updatedAt: new Date().toISOString() });
    var next = [snapshot].concat(repo.filter(function(r) { return r.id !== snapshot.id; })).slice(0, 300);
    persist(next);
    setSelectedId(snapshot.id);
    setSaveName("");
    setCard(snapshot);
  }

  function loadSaved(id) {
    setSelectedId(id);
    var found = repo.find(function(r) { return r.id === id; });
    if (found) setCard(found);
  }

  function deleteSaved() {
    if (!selectedId) return;
    var next = repo.filter(function(r) { return r.id !== selectedId; });
    persist(next);
    setSelectedId("");
    setCard(newLineCard());
  }

  function resetNew() {
    setSelectedId("");
    setCard(newLineCard());
  }

  function printPdf() {
    var win = window.open("", "_blank", "width=980,height=760");
    if (!win) return;
    var html = [
      "<!doctype html><html><head><title>Line Card - ", (card.productName || card.sku || "Line Card"), "</title>",
      "<style>body{font-family:Arial,sans-serif;padding:18px;color:#222}h1{margin:0 0 4px;font-size:24px}h2{margin:14px 0 6px;font-size:15px}table{border-collapse:collapse;width:100%;margin-top:6px}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px;vertical-align:top}th{background:#f5f7fa;text-align:left}.meta{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin:8px 0 10px}.box{border:1px solid #ddd;border-radius:6px;padding:6px 8px;background:#fcfcfd}.k{font-size:10px;color:#666}.v{font-weight:700;font-size:12px}.mono{font-family:ui-monospace,monospace;}</style>",
      "</head><body>",
      "<h1>", (card.productName || "Line Card"), "</h1>",
      "<div class='meta'>",
      "<div class='box'><div class='k'>SKU</div><div class='v mono'>", (card.sku || "--"), "</div></div>",
      "<div class='box'><div class='k'>Customer</div><div class='v'>", (card.customer || "--"), "</div></div>",
      "<div class='box'><div class='k'>Pack Config</div><div class='v'>", (card.packConfig || "--"), "</div></div>",
      "<div class='box'><div class='k'>Revision</div><div class='v'>", (card.revision || "--"), "</div></div>",
      "<div class='box'><div class='k'>Line</div><div class='v'>", (card.line || "--"), "</div></div>",
      "<div class='box'><div class='k'>Owner</div><div class='v'>", (card.owner || "--"), "</div></div>",
      "<div class='box'><div class='k'>Run Rate (UPH)</div><div class='v'>", (card.runRateUph || "--"), "</div></div>",
      "<div class='box'><div class='k'>Effective Date</div><div class='v'>", (card.effectiveDate || "--"), "</div></div>",
      "</div>",
      "<h2>Materials</h2><table><tr><th>Material</th><th>Spec</th><th>Notes</th></tr>",
      card.materials.map(function(m) { return "<tr><td>" + (m.name || "--") + "</td><td>" + (m.spec || "--") + "</td><td>" + (m.notes || "--") + "</td></tr>"; }).join(""),
      "</table>",
      "<h2>Setup Checklist</h2><table><tr><th>Task</th><th>Required</th></tr>",
      card.setupChecklist.map(function(r) { return "<tr><td>" + (r.task || "--") + "</td><td>" + (r.required ? "Yes" : "No") + "</td></tr>"; }).join(""),
      "</table>",
      "<h2>Quality Checks</h2><table><tr><th>Check</th><th>Frequency</th><th>Target</th></tr>",
      card.qualityChecks.map(function(q) { return "<tr><td>" + (q.check || "--") + "</td><td>" + (q.frequency || "--") + "</td><td>" + (q.target || "--") + "</td></tr>"; }).join(""),
      "</table>",
      "<h2>Safety Notes</h2><div>", (card.safetyNotes || "--"), "</div>",
      "<h2>Changeover Notes</h2><div>", (card.changeoverNotes || "--"), "</div>",
      "<h2>Troubleshooting</h2><div>", (card.troubleshooting || "--"), "</div>",
      "</body></html>"
    ].join("");
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(function() { win.print(); }, 250);
  }

  var repoLabel = useMemo(function() { return repo.length + " cards saved"; }, [repo.length]);

  return (
    <div style={{ border:"1px solid " + C.border, borderRadius:10, background:C.surface, padding:14, marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:16, fontWeight:700, color:C.bright }}>Line Card Generator + Repository</div>
          <div style={{ fontSize:13, color:C.dim }}>Create digital SKU line cards and print PDF-ready spec sheets for floor use.</div>
        </div>
        <span style={Object.assign({}, pill(false), { color:C.accent, borderColor:C.accentLine, background:C.accentSoft })}>Sandbox Tool</span>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:8, alignItems:"end", marginBottom:12 }}>
        <label style={{ display:"grid", gap:4 }}>
          <span style={{ fontSize:11, color:C.dim }}>Repository ({repoLabel})</span>
          <select value={selectedId} onChange={function(e) { loadSaved(e.target.value); }} style={sel}>
            <option value="">Select saved line card</option>
            {repo.map(function(r) { return <option key={r.id} value={r.id}>{(r.savedName || r.productName || r.sku || "Untitled")} - {fmtTs(r.updatedAt)}</option>; })}
          </select>
        </label>
        <button onClick={resetNew} style={Object.assign({}, pill(false), { height:34, color:C.bright, borderColor:C.border, background:C.raised })}>New</button>
        <button onClick={deleteSaved} style={Object.assign({}, pill(false), { height:34, color:C.bad, borderColor:C.badLine, background:C.badSoft })}>Delete</button>
        <button onClick={printPdf} style={Object.assign({}, pill(false), { height:34, color:C.bright, borderColor:C.border, background:C.raised })}>Print PDF</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:8, marginBottom:10 }}>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>SKU</span><input value={card.sku} onChange={function(e) { patch({ sku:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Product Name</span><input value={card.productName} onChange={function(e) { patch({ productName:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Customer</span><input value={card.customer} onChange={function(e) { patch({ customer:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Pack Config</span><input value={card.packConfig} onChange={function(e) { patch({ packConfig:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Revision</span><input value={card.revision} onChange={function(e) { patch({ revision:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Line</span><input value={card.line} onChange={function(e) { patch({ line:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Owner</span><input value={card.owner} onChange={function(e) { patch({ owner:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Run Rate (UPH)</span><input value={card.runRateUph} onChange={function(e) { patch({ runRateUph:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Effective Date</span><input type="date" value={card.effectiveDate} onChange={function(e) { patch({ effectiveDate:e.target.value }); }} style={inp} /></label>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, padding:10, background:C.raised, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.dim }}>Materials</div>
          <button onClick={function() { addRow("materials"); }} style={pill(false)}>+ Row</button>
        </div>
        <div style={{ display:"grid", gap:6 }}>
          {card.materials.map(function(m, idx) {
            return (
              <div key={idx} style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 2fr auto", gap:6 }}>
                <input value={m.name} onChange={function(e) { updateMaterial(idx, "name", e.target.value); }} style={inp} placeholder="Material name / code" />
                <input value={m.spec} onChange={function(e) { updateMaterial(idx, "spec", e.target.value); }} style={inp} placeholder="Spec" />
                <input value={m.notes} onChange={function(e) { updateMaterial(idx, "notes", e.target.value); }} style={inp} placeholder="Notes" />
                <button onClick={function() { removeRow("materials", idx); }} style={Object.assign({}, pill(false), { color:C.bad })}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, padding:10, background:C.raised, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.dim }}>Setup Checklist</div>
          <button onClick={function() { addRow("setup"); }} style={pill(false)}>+ Row</button>
        </div>
        <div style={{ display:"grid", gap:6 }}>
          {card.setupChecklist.map(function(r, idx) {
            return (
              <div key={idx} style={{ display:"grid", gridTemplateColumns:"3fr auto auto", gap:6 }}>
                <input value={r.task} onChange={function(e) { updateSetup(idx, "task", e.target.value); }} style={inp} placeholder="Setup task" />
                <label style={{ display:"inline-flex", alignItems:"center", gap:6, color:C.dim, fontSize:12 }}><input type="checkbox" checked={!!r.required} onChange={function(e) { updateSetup(idx, "required", e.target.checked); }} />Required</label>
                <button onClick={function() { removeRow("setup", idx); }} style={Object.assign({}, pill(false), { color:C.bad })}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, padding:10, background:C.raised, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.dim }}>Quality Checks</div>
          <button onClick={function() { addRow("quality"); }} style={pill(false)}>+ Row</button>
        </div>
        <div style={{ display:"grid", gap:6 }}>
          {card.qualityChecks.map(function(q, idx) {
            return (
              <div key={idx} style={{ display:"grid", gridTemplateColumns:"2fr 1.2fr 1.2fr auto", gap:6 }}>
                <input value={q.check} onChange={function(e) { updateQuality(idx, "check", e.target.value); }} style={inp} placeholder="Quality check" />
                <input value={q.frequency} onChange={function(e) { updateQuality(idx, "frequency", e.target.value); }} style={inp} placeholder="Frequency" />
                <input value={q.target} onChange={function(e) { updateQuality(idx, "target", e.target.value); }} style={inp} placeholder="Target / limit" />
                <button onClick={function() { removeRow("quality", idx); }} style={Object.assign({}, pill(false), { color:C.bad })}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:8, marginBottom:10 }}>
        <label style={{ display:"grid", gap:4 }}>
          <span style={{ fontSize:11, color:C.dim }}>Safety Notes</span>
          <textarea value={card.safetyNotes} onChange={function(e) { patch({ safetyNotes:e.target.value }); }} style={{ width:"100%", minHeight:70, resize:"vertical", border:"1px solid " + C.border, borderRadius:6, padding:"8px 10px", fontFamily:sans, fontSize:12, color:C.text, background:C.surface }} />
        </label>
        <label style={{ display:"grid", gap:4 }}>
          <span style={{ fontSize:11, color:C.dim }}>Changeover Notes</span>
          <textarea value={card.changeoverNotes} onChange={function(e) { patch({ changeoverNotes:e.target.value }); }} style={{ width:"100%", minHeight:70, resize:"vertical", border:"1px solid " + C.border, borderRadius:6, padding:"8px 10px", fontFamily:sans, fontSize:12, color:C.text, background:C.surface }} />
        </label>
        <label style={{ display:"grid", gap:4 }}>
          <span style={{ fontSize:11, color:C.dim }}>Troubleshooting</span>
          <textarea value={card.troubleshooting} onChange={function(e) { patch({ troubleshooting:e.target.value }); }} style={{ width:"100%", minHeight:70, resize:"vertical", border:"1px solid " + C.border, borderRadius:6, padding:"8px 10px", fontFamily:sans, fontSize:12, color:C.text, background:C.surface }} />
        </label>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"end" }}>
        <label style={{ display:"grid", gap:4 }}>
          <span style={{ fontSize:11, color:C.dim }}>Save Name</span>
          <input value={saveName} onChange={function(e) { setSaveName(e.target.value); }} style={inp} placeholder="Line card name for repository" />
        </label>
        <button onClick={saveCurrent} style={Object.assign({}, pill(false), { height:34, color:C.bright, borderColor:C.border, background:C.raised })}>Save Line Card</button>
      </div>
    </div>
  );
}
