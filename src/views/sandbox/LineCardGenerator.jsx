import { useState, useEffect } from "react";
import { useTheme } from "../../theme";
import { useStyles } from "../../hooks/useStyles";

const REPO_KEY = "pp-line-card-repository-v3";
const DEFAULT_LOGO = "https://revcopack.com/wp-content/uploads/2025/07/rev-copack_full-logo_all-yellow-768x181.png";

function makeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

const MONSTER_TEMPLATE = {
  themeColor: "#00C853",
  warnColor: "#ff6b35",
  skuTitle: "Monster Ultra VP ZSWP",
  subtitle: "Item #118780 | UPC: 070847900559 | 2/12 Pack | 16 FL OZ | Ultra Sunrise · Ultra Wild Passion · Ultra Zero",
  footerLeft: "REV COPACK · Monster Ultra VP ZSWP · Item #118780",
  footerRight: "For Internal Use Only",
  showBalerAlert: false,
  balerAlertText: "",
  logoUrl: DEFAULT_LOGO,
  specRows: [
    { label: "Product Name", value: "Monster Ultra VP ZSWP" },
    { label: "Item #", value: "118780" },
    { label: "UPC", value: "070847900559" },
    { label: "Can Size", value: "16 FL OZ" },
    { label: "WIP Components", value: "• Monster Ultra Sunrise (Orange)\n• Monster Ultra Wild Passion (Purple)\n• Monster Ultra Zero (White/Silver)" },
    { label: "Pack Config", value: "2 cartons per tray | 12 cans per carton" },
    { label: "Cans / Flavor", value: "4 cans of each flavor per carton\n4 Sunrise + 4 Wild Passion + 4 Zero = 12 total" },
    { label: "Shrink Wrap", value: "NO — Product is NOT shrink wrapped" },
    { label: "Barcode Label", value: "Applied to SHORT SIDE of tray wall" },
    { label: "Pallet Type", value: "CHEP PALLET ONLY (blue pallet)" },
    { label: "Pallet Config", value: "10 cases per layer | 7 layers high\nTotal: 70 cases per pallet\nStack pattern ALTERNATES each layer" }
  ],
  qcRows: [
    { title: "1. Flavor Count", detail: "Each carton must contain exactly 4 cans of each flavor: 4 × Ultra Sunrise · 4 × Ultra Wild Passion · 4 × Ultra Zero · Total = 12 cans" },
    { title: "2. Carton Glue", detail: "All cartons must be properly glued. No open seams, lifted flaps, or loose panels." },
    { title: "3. Barcode Label", detail: "Correct barcode applied to SHORT SIDE of tray wall. Must be readable and properly aligned." },
    { title: "4. Date Code", detail: "Verify correct date code is applied and legible per production schedule." },
    { title: "5. No Shrink Wrap", detail: "Confirm product is NOT shrink wrapped. This SKU ships open-tray only." },
    { title: "6. CHEP Pallet", detail: "CHEP pallet ONLY (blue). No plain wood or white pallets. Confirm CHEP logo is visible." },
    { title: "7. Stack Pattern", detail: "10 cases/layer | 7 layers high | 70 cases total. Pattern ALTERNATES each layer." }
  ],
  photoRows: [
    { title: "WIP Flavors", note: "All 3 flavors must be present. 4 cans of each per carton.", imageUrl: "" },
    { title: "Tray Barcode Label", note: "Item #118780 | UPC 070847900559. Applied to SHORT SIDE.", imageUrl: "" },
    { title: "CHEP Pallet", note: "Blue CHEP pallet ONLY.", imageUrl: "" },
    { title: "Stack Pattern", note: "10/layer | 7 layers | 70 total. Pattern ALTERNATES each layer.", imageUrl: "" }
  ]
};

const KIRKLAND_TEMPLATE = {
  themeColor: "#004B87",
  warnColor: "#C8102E",
  skuTitle: "Kirkland Signature 18PK Variety — Vodka + Soda",
  subtitle: "Item #511-30-9905 | 18-Pack Carton | Pineapple · Watermelon · Peach · 6 Cans of Each Flavor",
  footerLeft: "REV COPACK · Kirkland Signature 18PK Variety · Item #511-30-9905",
  footerRight: "For Internal Use Only",
  showBalerAlert: true,
  balerAlertText: "IMPORTANT — WIP tray disposal: WIP trays are NOT used in finished pack. Dispose all WIP trays in the BALER.",
  logoUrl: DEFAULT_LOGO,
  specRows: [
    { label: "Product Name", value: "Kirkland Signature 18PK Variety" },
    { label: "Item #", value: "511-30-9905" },
    { label: "WIP Components", value: "• Pineapple\n• Watermelon\n• Peach" },
    { label: "Cans / Flavor", value: "6 cans of each flavor per carton\n6 Pineapple + 6 Watermelon + 6 Peach = 18 total" },
    { label: "Finished Pack", value: "Cardboard carton — 18 cans per carton" },
    { label: "Tray", value: "NO TRAY — Loose WIP trays disposed of in baler" },
    { label: "Date Code", value: "BEST BY date of oldest can in carton\nBEST BY MM/DD/YYYY\n6055 RP14:10 (example)" },
    { label: "Barcode Label", value: "NONE — No barcode label applied" },
    { label: "Shrink Wrap", value: "NO — Product ships carton only" },
    { label: "Pallet Type", value: "CHEP PALLET ONLY (blue pallet)" },
    { label: "Pallet Config", value: "21 cases per layer | 7 layers high\nTotal: 147 cases per pallet\nStack pattern ALTERNATES each layer" },
    { label: "Corner Boards", value: "4 corner boards required per pallet" },
    { label: "Slip Sheets", value: "1 BOTTOM slip sheet | 1 TOP slip sheet" },
    { label: "Stretch Wrap", value: "4 wraps BOTTOM | 4 wraps TOP" }
  ],
  qcRows: [
    { title: "1. Flavor Count", detail: "Each carton must contain exactly 6 cans of each flavor: 6 × Pineapple · 6 × Watermelon · 6 × Peach." },
    { title: "2. Carton Glue", detail: "All cartons must be properly glued. No open seams, lifted flaps, or loose panels." },
    { title: "3. No Barcode / No Tray", detail: "NO barcode label applied. NO tray used — dispose all WIP trays in baler." },
    { title: "4. Date Code", detail: "Must reflect BEST BY date of oldest can. Line 1: BEST BY MM/DD/YYYY. Line 2: Last year digit + Julian + RP + 24hr time." },
    { title: "5. No Shrink Wrap", detail: "Confirm product is NOT shrink wrapped. Ships carton only." },
    { title: "6. CHEP Pallet", detail: "CHEP pallet ONLY (blue). No plain wood or white pallets." },
    { title: "7. Stack Pattern", detail: "21 cases/layer | 7 layers high | 147 cases total. Pattern ALTERNATES each layer." },
    { title: "8. Slip Sheets", detail: "1 BOTTOM slip sheet under stack and 1 TOP slip sheet on top of stack." },
    { title: "9. Corner Boards & Stretch Wrap", detail: "4 corner boards per pallet. Stretch wrap with 4 wraps BOTTOM and 4 wraps TOP." }
  ],
  photoRows: [
    { title: "CHEP Pallet", note: "Blue CHEP pallet ONLY. No plain wood or white pallets.", imageUrl: "" },
    { title: "Stack / Layer Pattern", note: "21/layer | 7 layers | 147 total. Pattern ALTERNATES each layer.", imageUrl: "" },
    { title: "Finished Pallet", note: "Corner boards, top slip sheet, and stretch wrap applied.", imageUrl: "" },
    { title: "Date Code Printer", note: "KEYENCE printer. Verify correct date before running.", imageUrl: "" },
    { title: "Date Code on Carton", note: "BEST BY date printed on top of carton. Verify legibility.", imageUrl: "" }
  ]
};

function newLineCard() {
  return {
    id: makeId(),
    themeColor: "#00C853",
    warnColor: "#ff6b35",
    skuTitle: "",
    subtitle: "",
    footerLeft: "REV COPACK",
    footerRight: "For Internal Use Only",
    showBalerAlert: false,
    balerAlertText: "",
    logoUrl: DEFAULT_LOGO,
    specRows: [
      { label: "Product Name", value: "" },
      { label: "Item #", value: "" },
      { label: "WIP Components", value: "" },
      { label: "Pack Config", value: "" }
    ],
    qcRows: [
      { title: "1. Flavor Count", detail: "" },
      { title: "2. Carton Glue", detail: "" },
      { title: "3. Date Code", detail: "" }
    ],
    photoRows: [],
    updatedAt: new Date().toISOString()
  };
}

function hydrateCard(raw) {
  var base = newLineCard();
  if (!raw || typeof raw !== "object") return base;
  return {
    id: raw.id || makeId(),
    themeColor: raw.themeColor || base.themeColor,
    warnColor: raw.warnColor || base.warnColor,
    skuTitle: raw.skuTitle || "",
    subtitle: raw.subtitle || "",
    footerLeft: raw.footerLeft || raw.footer || base.footerLeft,
    footerRight: raw.footerRight || "For Internal Use Only",
    showBalerAlert: !!raw.showBalerAlert,
    balerAlertText: raw.balerAlertText || "",
    logoUrl: raw.logoUrl || DEFAULT_LOGO,
    specRows: Array.isArray(raw.specRows) && raw.specRows.length ? raw.specRows : base.specRows,
    qcRows: Array.isArray(raw.qcRows) && raw.qcRows.length ? raw.qcRows : base.qcRows,
    photoRows: Array.isArray(raw.photoRows) ? raw.photoRows : [],
    savedName: raw.savedName || "",
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

function fmtTs(ts) {
  if (!ts) return "--";
  var d = new Date(ts);
  return isNaN(d) ? "--" : d.toLocaleString();
}

function normalizeHexColor(v, fallback) {
  var raw = String(v || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return fallback;
}

export default function LineCardGenerator() {
  const { C } = useTheme();
  const { inp, sel, pill } = useStyles();

  const [card, setCard] = useState(newLineCard());
  const [repo, setRepo] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [saveName, setSaveName] = useState("");

  useEffect(function() {
    try {
      var raw = window.localStorage.getItem(REPO_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setRepo(parsed.map(hydrateCard));
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

  function applyTemplate(template) {
    patch(Object.assign({}, template, { id: makeId() }));
    setSelectedId("");
    setSaveName("");
  }

  function updateSpec(idx, field, value) {
    setCard(function(prev) {
      var next = prev.specRows.slice();
      next[idx] = Object.assign({}, next[idx], { [field]: value });
      return Object.assign({}, prev, { specRows: next, updatedAt: new Date().toISOString() });
    });
  }

  function updateQc(idx, field, value) {
    setCard(function(prev) {
      var next = prev.qcRows.slice();
      next[idx] = Object.assign({}, next[idx], { [field]: value });
      return Object.assign({}, prev, { qcRows: next, updatedAt: new Date().toISOString() });
    });
  }

  function updatePhoto(idx, field, value) {
    setCard(function(prev) {
      var next = prev.photoRows.slice();
      next[idx] = Object.assign({}, next[idx], { [field]: value });
      return Object.assign({}, prev, { photoRows: next, updatedAt: new Date().toISOString() });
    });
  }

  function addRow(kind) {
    setCard(function(prev) {
      if (kind === "spec") return Object.assign({}, prev, { specRows: prev.specRows.concat([{ label: "", value: "" }]), updatedAt: new Date().toISOString() });
      if (kind === "qc") return Object.assign({}, prev, { qcRows: prev.qcRows.concat([{ title: "", detail: "" }]), updatedAt: new Date().toISOString() });
      return Object.assign({}, prev, { photoRows: prev.photoRows.concat([{ title: "", note: "", imageUrl: "" }]), updatedAt: new Date().toISOString() });
    });
  }

  function removeRow(kind, idx) {
    setCard(function(prev) {
      if (kind === "spec") {
        var nextS = prev.specRows.filter(function(_, i) { return i !== idx; });
        return Object.assign({}, prev, { specRows: nextS.length ? nextS : [{ label: "", value: "" }], updatedAt: new Date().toISOString() });
      }
      if (kind === "qc") {
        var nextQ = prev.qcRows.filter(function(_, i) { return i !== idx; });
        return Object.assign({}, prev, { qcRows: nextQ.length ? nextQ : [{ title: "", detail: "" }], updatedAt: new Date().toISOString() });
      }
      var nextP = prev.photoRows.filter(function(_, i) { return i !== idx; });
      return Object.assign({}, prev, { photoRows: nextP, updatedAt: new Date().toISOString() });
    });
  }

  function saveCurrent() {
    var name = String(saveName || card.skuTitle || "Untitled Line Card").trim();
    if (!name) return;
    var snapshot = hydrateCard(Object.assign({}, card, { id: card.id || makeId(), savedName: name, updatedAt: new Date().toISOString() }));
    var next = [snapshot].concat(repo.filter(function(r) { return r.id !== snapshot.id; })).slice(0, 400);
    persist(next);
    setSelectedId(snapshot.id);
    setSaveName("");
    setCard(snapshot);
  }

  function loadSaved(id) {
    setSelectedId(id);
    var found = repo.find(function(r) { return r.id === id; });
    if (found) setCard(hydrateCard(found));
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
    var color = normalizeHexColor(card.themeColor, "#00C853");
    var warn = normalizeHexColor(card.warnColor, "#ff6b35");
    var win = window.open("", "_blank", "width=1200,height=820");
    if (!win) return;
    var html = [
      "<!doctype html><html><head><title>Line Card - ", (card.skuTitle || "Line Card"), "</title>",
      "<style>",
      "body{background:#0d0d0d;color:#fff;font-family:Arial,sans-serif;margin:0;padding:16px}",
      ".page{max-width:1180px;margin:0 auto;background:#0d0d0d;border:1px solid #2a2a2a}",
      ".header{display:flex;justify-content:space-between;align-items:center;background:#0d0d0d;border-bottom:3px solid ", color, ";padding:14px 20px}",
      ".header img{height:46px}.rc{color:", color, ";font-size:12px;letter-spacing:3px;font-weight:700;text-transform:uppercase;text-align:right}.ri{font-size:10px;letter-spacing:2px;color:#666;text-transform:uppercase}",
      ".pbar{background:#1a1a1a;border-left:5px solid ", color, ";padding:12px 20px}",
      ".pt{font-size:26px;font-weight:800;color:", color, ";text-transform:uppercase}.ps{font-size:12px;color:#a0a0a0;margin-top:3px}",
      ".tw{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:16px 20px}",
      ".card{background:#1a1a1a;border:1px solid #333}.ch{background:", color, ";color:#fff;font-weight:800;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:7px 10px}",
      "table{width:100%;border-collapse:collapse}.spec tr:nth-child(even){background:#1f1f1f}.spec td{padding:7px 9px;border-bottom:1px solid #2a2a2a;vertical-align:top}",
      ".sl{width:34%;color:#b5b5b5;font-size:11px;font-weight:700;text-transform:uppercase}.sv{font-size:12px;white-space:pre-line}",
      ".qc{list-style:none;margin:0;padding:0}.qci{display:flex;gap:10px;padding:8px 10px;border-bottom:1px solid #2a2a2a}.qci:nth-child(even){background:#1f1f1f}",
      ".cb{width:16px;height:16px;border:2px solid ", color, ";border-radius:3px;flex-shrink:0;margin-top:2px}",
      ".qt{font-size:12px;font-weight:800;color:", color, ";text-transform:uppercase}.qd{font-size:12px;color:#c0c0c0;white-space:pre-line}",
      ".alert{margin:0 20px 12px;background:rgba(0,0,0,0.2);border:1px solid ", color, ";border-left:4px solid ", warn, ";padding:9px 12px;font-size:12px;color:#d0d0d0}",
      ".photos{padding:0 20px 16px}.sb{background:", color, ";padding:7px 10px;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px}",
      ".pg{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.pc{background:#1a1a1a;border:1px solid #333}.ph{height:140px;background:#121212;display:flex;align-items:center;justify-content:center;color:#666;font-size:11px}.ph img{width:100%;height:100%;object-fit:cover}",
      ".cap{background:#2a2a2a;padding:5px 8px;font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:", color, "}.note{padding:6px 8px;font-size:10px;color:#888}",
      ".f{display:flex;justify-content:space-between;align-items:center;background:#1a1a1a;border-top:1px solid #333;padding:9px 20px;font-size:10px;color:#666}.f span{color:", color, "}",
      "</style></head><body>",
      "<div class='page'>",
      "<div class='header'><img src='", (card.logoUrl || DEFAULT_LOGO), "' alt='logo'><div><div class='rc'>Line Card</div><div class='ri'>For Internal Use Only</div></div></div>",
      "<div class='pbar'><div class='pt'>", (card.skuTitle || "SKU TITLE"), "</div><div class='ps'>", (card.subtitle || ""), "</div></div>",
      "<div class='tw'>",
      "<div class='card'><div class='ch'>Product Specifications</div><table class='spec'>",
      card.specRows.map(function(r) { return "<tr><td class='sl'>" + (r.label || "--") + "</td><td class='sv'>" + (r.value || "--") + "</td></tr>"; }).join(""),
      "</table></div>",
      "<div class='card'><div class='ch'>QC Checkpoints</div><ul class='qc'>",
      card.qcRows.map(function(r) { return "<li class='qci'><div class='cb'></div><div><div class='qt'>" + (r.title || "--") + "</div><div class='qd'>" + (r.detail || "--") + "</div></div></li>"; }).join(""),
      "</ul></div>",
      "</div>",
      card.showBalerAlert ? "<div class='alert'><b>IMPORTANT:</b> " + (card.balerAlertText || "") + "</div>" : "",
      card.photoRows.length ? "<div class='photos'><div class='sb'>Reference Photos</div><div class='pg'>" + card.photoRows.map(function(p) {
        return "<div class='pc'><div class='ph'>" + (p.imageUrl ? "<img src='" + p.imageUrl + "' alt='photo'>" : "PHOTO") + "</div><div class='cap'>" + (p.title || "Photo") + "</div><div class='note'>" + (p.note || "") + "</div></div>";
      }).join("") + "</div></div>" : "",
      "<div class='f'><div>", (card.footerLeft || "REV COPACK"), "</div><div><span>", (card.footerRight || "For Internal Use Only"), "</span></div></div>",
      "</div></body></html>"
    ].join("");
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(function() { win.print(); }, 300);
  }

  var color = normalizeHexColor(card.themeColor, "#00C853");
  var warn = normalizeHexColor(card.warnColor, "#ff6b35");

  return (
    <div style={{ border:"1px solid " + C.border, borderRadius:10, background:C.surface, padding:14, marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:16, fontWeight:700, color:C.bright }}>Line Card Generator + Repository</div>
          <div style={{ fontSize:13, color:C.dim }}>Updated from your Monster/Kirkland HTML line cards (header, spec/QC panels, alert, reference photos, print layout).</div>
        </div>
        <span style={Object.assign({}, pill(false), { color:C.accent, borderColor:C.accentLine, background:C.accentSoft })}>Sandbox Tool</span>
      </div>

      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <button onClick={function() { applyTemplate(MONSTER_TEMPLATE); }} style={pill(false)}>Load Monster Template</button>
        <button onClick={function() { applyTemplate(KIRKLAND_TEMPLATE); }} style={pill(false)}>Load Kirkland Template</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:8, alignItems:"end", marginBottom:10 }}>
        <label style={{ display:"grid", gap:4 }}>
          <span style={{ fontSize:11, color:C.dim }}>Repository ({repo.length} cards)</span>
          <select value={selectedId} onChange={function(e) { loadSaved(e.target.value); }} style={sel}>
            <option value="">Select saved line card</option>
            {repo.map(function(r) { return <option key={r.id} value={r.id}>{(r.savedName || r.skuTitle || "Untitled")} - {fmtTs(r.updatedAt)}</option>; })}
          </select>
        </label>
        <button onClick={resetNew} style={Object.assign({}, pill(false), { height:34, color:C.bright, borderColor:C.border, background:C.raised })}>New</button>
        <button onClick={deleteSaved} style={Object.assign({}, pill(false), { height:34, color:C.bad, borderColor:C.badLine, background:C.badSoft })}>Delete</button>
        <button onClick={printPdf} style={Object.assign({}, pill(false), { height:34, color:C.bright, borderColor:C.border, background:C.raised })}>Print PDF</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1.5fr 2fr 1fr 1fr", gap:8, marginBottom:10 }}>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>SKU Header</span><input value={card.skuTitle} onChange={function(e) { patch({ skuTitle:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Subtitle</span><input value={card.subtitle} onChange={function(e) { patch({ subtitle:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Theme Color</span><input value={card.themeColor} onChange={function(e) { patch({ themeColor:e.target.value }); }} style={inp} placeholder="#00C853" /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Warn Color</span><input value={card.warnColor} onChange={function(e) { patch({ warnColor:e.target.value }); }} style={inp} placeholder="#ff6b35" /></label>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:8, marginBottom:10 }}>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Logo URL</span><input value={card.logoUrl || ""} onChange={function(e) { patch({ logoUrl:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Footer Left</span><input value={card.footerLeft || ""} onChange={function(e) { patch({ footerLeft:e.target.value }); }} style={inp} /></label>
        <label style={{ display:"grid", gap:4 }}><span style={{ fontSize:11, color:C.dim }}>Footer Right</span><input value={card.footerRight || ""} onChange={function(e) { patch({ footerRight:e.target.value }); }} style={inp} /></label>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:10, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:12, color:C.dim, fontWeight:700 }}>PRODUCT SPECIFICATIONS</div>
          <button onClick={function() { addRow("spec"); }} style={pill(false)}>+ Row</button>
        </div>
        <div style={{ display:"grid", gap:6 }}>
          {card.specRows.map(function(r, idx) {
            return (
              <div key={idx} style={{ display:"grid", gridTemplateColumns:"1.1fr 2.4fr auto", gap:6 }}>
                <input value={r.label} onChange={function(e) { updateSpec(idx, "label", e.target.value); }} style={inp} placeholder="Label" />
                <input value={r.value} onChange={function(e) { updateSpec(idx, "value", e.target.value); }} style={inp} placeholder="Value (use \\n for line breaks)" />
                <button onClick={function() { removeRow("spec", idx); }} style={Object.assign({}, pill(false), { color:C.bad })}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:10, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:12, color:C.dim, fontWeight:700 }}>QC CHECKPOINTS</div>
          <button onClick={function() { addRow("qc"); }} style={pill(false)}>+ Row</button>
        </div>
        <div style={{ display:"grid", gap:6 }}>
          {card.qcRows.map(function(r, idx) {
            return (
              <div key={idx} style={{ display:"grid", gridTemplateColumns:"1.1fr 2.4fr auto", gap:6 }}>
                <input value={r.title} onChange={function(e) { updateQc(idx, "title", e.target.value); }} style={inp} placeholder={"Checkpoint " + (idx + 1)} />
                <input value={r.detail} onChange={function(e) { updateQc(idx, "detail", e.target.value); }} style={inp} placeholder="Instruction detail" />
                <button onClick={function() { removeRow("qc", idx); }} style={Object.assign({}, pill(false), { color:C.bad })}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, background:C.raised, padding:10, marginBottom:10 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:12, color:C.dim, fontWeight:700 }}>Reference Photos</div>
          <button onClick={function() { addRow("photo"); }} style={pill(false)}>+ Photo</button>
        </div>
        {card.photoRows.length === 0 ? (
          <div style={{ fontSize:12, color:C.dim }}>No photos added.</div>
        ) : (
          <div style={{ display:"grid", gap:6 }}>
            {card.photoRows.map(function(p, idx) {
              return (
                <div key={idx} style={{ display:"grid", gridTemplateColumns:"1fr 1.2fr 1.5fr auto", gap:6 }}>
                  <input value={p.title} onChange={function(e) { updatePhoto(idx, "title", e.target.value); }} style={inp} placeholder="Caption title" />
                  <input value={p.note} onChange={function(e) { updatePhoto(idx, "note", e.target.value); }} style={inp} placeholder="Caption note" />
                  <input value={p.imageUrl} onChange={function(e) { updatePhoto(idx, "imageUrl", e.target.value); }} style={inp} placeholder="Image URL (optional)" />
                  <button onClick={function() { removeRow("photo", idx); }} style={Object.assign({}, pill(false), { color:C.bad })}>Remove</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:8, alignItems:"end", marginBottom:10 }}>
        <label style={{ display:"inline-flex", alignItems:"center", gap:8, fontSize:12, color:C.dim }}>
          <input type="checkbox" checked={!!card.showBalerAlert} onChange={function(e) { patch({ showBalerAlert:e.target.checked }); }} />
          Show Alert Box
        </label>
        <input value={card.balerAlertText || ""} onChange={function(e) { patch({ balerAlertText:e.target.value }); }} style={inp} placeholder="Important alert text (e.g., tray disposal / baler instruction)" />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"end", marginBottom:12 }}>
        <label style={{ display:"grid", gap:4 }}>
          <span style={{ fontSize:11, color:C.dim }}>Save Name</span>
          <input value={saveName} onChange={function(e) { setSaveName(e.target.value); }} style={inp} placeholder="Kirkland 18PK Rev A" />
        </label>
        <button onClick={saveCurrent} style={Object.assign({}, pill(false), { height:34, color:C.bright, borderColor:C.border, background:C.raised })}>Save Line Card</button>
      </div>

      <div style={{ border:"1px solid " + C.border, borderRadius:8, overflow:"hidden", background:"#0d0d0d" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#0d0d0d", borderBottom:"3px solid " + color, padding:"10px 12px" }}>
          <img src={card.logoUrl || DEFAULT_LOGO} alt="logo" style={{ height:32, objectFit:"contain" }} />
          <div style={{ textAlign:"right" }}>
            <div style={{ color:color, fontSize:11, letterSpacing:2, fontWeight:700, textTransform:"uppercase" }}>Line Card</div>
            <div style={{ color:"#666", fontSize:10, letterSpacing:1.5, textTransform:"uppercase" }}>For Internal Use Only</div>
          </div>
        </div>
        <div style={{ background:"#1a1a1a", borderLeft:"5px solid " + color, padding:"8px 12px" }}>
          <div style={{ color:color, fontSize:18, fontWeight:800, textTransform:"uppercase" }}>{card.skuTitle || "SKU HEADER"}</div>
          <div style={{ color:"#9a9a9a", fontSize:11, marginTop:2 }}>{card.subtitle || "Subtitle"}</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, padding:10 }}>
          <div style={{ border:"1px solid #333", background:"#1a1a1a" }}>
            <div style={{ background:color, color:"#fff", fontSize:11, fontWeight:800, letterSpacing:1.5, textTransform:"uppercase", padding:"6px 8px" }}>Product Specifications</div>
            {card.specRows.map(function(r, idx) {
              return (
                <div key={idx} style={{ display:"grid", gridTemplateColumns:"34% 66%", borderBottom:"1px solid #2a2a2a", background:idx % 2 === 1 ? "#1f1f1f" : "transparent" }}>
                  <div style={{ color:"#a5a5a5", fontSize:10, fontWeight:700, textTransform:"uppercase", padding:"6px 8px" }}>{r.label || "--"}</div>
                  <div style={{ color:"#fff", fontSize:11, whiteSpace:"pre-line", padding:"6px 8px" }}>{r.value || "--"}</div>
                </div>
              );
            })}
          </div>
          <div style={{ border:"1px solid #333", background:"#1a1a1a" }}>
            <div style={{ background:color, color:"#fff", fontSize:11, fontWeight:800, letterSpacing:1.5, textTransform:"uppercase", padding:"6px 8px" }}>QC Checkpoints</div>
            {card.qcRows.map(function(r, idx) {
              return (
                <div key={idx} style={{ display:"flex", gap:8, borderBottom:"1px solid #2a2a2a", background:idx % 2 === 1 ? "#1f1f1f" : "transparent", padding:"6px 8px" }}>
                  <span style={{ width:14, height:14, border:"2px solid " + color, borderRadius:3, marginTop:2, flexShrink:0 }} />
                  <div>
                    <div style={{ color:color, fontSize:11, fontWeight:800, textTransform:"uppercase" }}>{r.title || "--"}</div>
                    <div style={{ color:"#c0c0c0", fontSize:11, whiteSpace:"pre-line" }}>{r.detail || "--"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {card.showBalerAlert && (
          <div style={{ margin:"0 10px 10px", background:"rgba(0,0,0,0.2)", border:"1px solid " + color, borderLeft:"4px solid " + warn, borderRadius:4, padding:"8px 10px", color:"#d0d0d0", fontSize:11 }}>
            <b style={{ color:"#fff" }}>IMPORTANT:</b> {card.balerAlertText || "--"}
          </div>
        )}
        {card.photoRows.length > 0 && (
          <div style={{ padding:"0 10px 10px" }}>
            <div style={{ background:color, color:"#fff", fontSize:11, fontWeight:800, letterSpacing:1.5, textTransform:"uppercase", padding:"6px 8px", marginBottom:8 }}>Reference Photos</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:8 }}>
              {card.photoRows.map(function(p, idx) {
                return (
                  <div key={idx} style={{ border:"1px solid #333", background:"#1a1a1a" }}>
                    <div style={{ height:90, background:"#111", display:"flex", alignItems:"center", justifyContent:"center", color:"#555", fontSize:10 }}>
                      {p.imageUrl ? <img src={p.imageUrl} alt={p.title || "photo"} style={{ width:"100%", height:"100%", objectFit:"cover" }} /> : "PHOTO"}
                    </div>
                    <div style={{ background:"#2a2a2a", color:color, padding:"4px 6px", fontSize:10, fontWeight:800, textTransform:"uppercase" }}>{p.title || "Photo"}</div>
                    <div style={{ color:"#888", padding:"5px 6px", fontSize:10 }}>{p.note || ""}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ background:"#1a1a1a", borderTop:"1px solid #333", padding:"8px 10px", display:"flex", justifyContent:"space-between", color:"#666", fontSize:10 }}>
          <div>{card.footerLeft || "REV COPACK"}</div>
          <div style={{ color:color }}>{card.footerRight || "For Internal Use Only"}</div>
        </div>
      </div>
    </div>
  );
}
