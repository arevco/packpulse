export function safeNum(v) { if (v == null || v === "") return 0; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
export function normalizeStr(s) { return String(s || "").replace(/[^a-z0-9]/gi, "").toLowerCase(); }
export function fmtDate(v) { if (!v) return "--"; var d = v instanceof Date ? v : new Date(v); if (isNaN(d)) return String(v); return (d.getMonth()+1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(-2); }
export function formatDescriptionForDisplay(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  var compact = raw.replace(/\s+/g, " ");
  var letters = compact.replace(/[^A-Za-z]/g, "");
  var looksAllCaps = !!letters && letters === letters.toUpperCase();
  if (!looksAllCaps) return compact;

  var keepUpper = {
    US:true, SKU:true, PO:true, BOM:true, FG:true, RM:true,
    WIP:true, VP:true, IB:true, OB:true, PK:true, CT:true,
    OZ:true, LBS:true, LB:true, KG:true, ML:true, EA:true
  };

  var formatToken = function(token) {
    if (!token) return token;
    if (token.indexOf("-") >= 0) return token.split("-").map(formatToken).join("-");
    if (token.indexOf("/") >= 0) return token.split("/").map(formatToken).join("/");
    if (/^\d+(\.\d+)?$/.test(token)) return token;
    if (/^[A-Z]+$/.test(token)) {
      if (keepUpper[token] || token.length <= 2) return token;
      return token.charAt(0) + token.slice(1).toLowerCase();
    }
    return token;
  };

  return compact.split(" ").map(formatToken).join(" ");
}
export function detectPackType(value, skuValue) {
  var raw = String(value || "").toUpperCase();
  if (!raw) return "Other";
  var cleaned = raw.replace(/\s+/g, " ").trim();
  var skuRaw = String(skuValue || "").toUpperCase();
  var skuNorm = skuRaw.replace(/[^A-Z0-9]/g, "");

  // Explicit SKU overrides for known RSC line items.
  var RSC_SKUS = {
    "114634": true, "114635": true, "114715": true, "114716": true, "116495": true
  };
  if (RSC_SKUS[skuNorm]) return "RSC";

  // Keep RSC separate from 15-pack to support planner-level segmentation.
  if (/\bRSC\b/.test(cleaned)) return "RSC";

  // 2/12 family
  if (/\b2\s*\/\s*12\b/.test(cleaned)) return "2/12 PACK";

  // Explicit pack labels
  if (/\b24\s*(?:PK|PACK)\b/.test(cleaned)) return "24 PACK";
  if (/\b18\s*(?:PK|PACK)\b/.test(cleaned)) return "18 PACK";
  if (/\b15\s*(?:PK|PACK)\b/.test(cleaned)) return "15 PACK";
  if (/\b12\s*(?:PK|PACK)\b/.test(cleaned)) return "12 PACK";

  // Size shorthand often used in beverage SKUs: "24/16OZ", "15/16 OZ", "18/12OZ"
  // First number typically represents can count per case/pack.
  var m = cleaned.match(/\b(\d{1,2})\s*\/\s*\d{1,3}(?:\.\d+)?\s*(?:OZ|ML|L)\b/);
  if (m) {
    var n = Number(m[1]);
    if (n === 24) return "24 PACK";
    if (n === 18) return "18 PACK";
    if (n === 15) return "15 PACK";
    if (n === 12) return "12 PACK";
    return n + " PACK";
  }

  return "Other";
}
export function autoMapColumns(headers, patterns) {
  const map = {}; const normed = headers.map(h => ({ orig:h, norm:normalizeStr(h) }));
  Object.entries(patterns).forEach(([field, cands]) => { for (const c of cands) { const m = normed.find(h => h.norm.includes(c.toLowerCase())); if (m) { map[field] = m.orig; break; } } });
  return map;
}
export function triggerDownload(content, filename, mimeType) {
  try { var b = new Blob([content], { type:mimeType }); var u = URL.createObjectURL(b); var a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); } catch(e) { console.error(e); }
}
export function buildExportHTML(title, headerCells, bodyRows) {
  var css = "body{font-family:Arial,sans-serif;margin:24px;color:#222}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:11px}th{background:#f0f0f0;padding:8px;text-align:left;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:8px;border-bottom:1px solid #eee}.ready{color:#1c9858}.partial{color:#b88510}.blocked{color:#cc3838}.nobom{color:#3b6fd8}.zero{color:#cc3838}.low{color:#b88510}";
  var parts = ["<!DOCTYPE html>", "<html>", "<head>", "<title>", title, "</title>", "<style>", css, "</style>", "</head>", "<body>", "<h1>", title, "</h1>", "<p>Generated ", new Date().toLocaleString(), "</p>", "<table>", "<thead>", "<tr>", headerCells, "</tr>", "</thead>", "<tbody>", bodyRows, "</tbody>", "</table>", "</body>", "</html>"];
  return parts.join("");
}

export const INV_PAT = {
  sku:["itemcode","sku","item","material","partnumber"],
  description:["description","desc","itemname","name"],
  qtyOnHand:["qtyonhand","onhand","basequantity","available","stock","instock","quantity"],
  status:["status","inventorystatus","itemstatus","lotstatus","qualitystatus","disposition"],
  location:["locationname","location","storagelocationname","storagelocation","inventorylocation","warehouselocation","binlocation","zone"],
  lotCode:["lotcode","lot","batch","lotnumber"],
  palletNumber:["palletnumber","pallet","licenseplate","lp"]
};
export const BOM_PAT = { bomId:["finishedgoodcode","bomid","parentsku","parent","fgcode"], componentSku:["subcomponentcode","componentsku","childsku","component","material"], description:["subcomponentdescription","componentdescription","itemdescription","materialdescription","subcomponentname","componentname","description","desc"], qtyPer:["qtyper","quantity","ratio","usage","per"], substituteFor:["substitutefor","altfor","replacementfor","subfor"], priority:["priority","prio","rank","preference"] };
export const WO_PAT = { woNumber:["workordercode","wonum","wonumber","workorder","wo"], productSku:["itemcode","productsku","sku","material","fgsku"], qtyToProduce:["unitsexpected","qtytoproduce","orderqty","quantity","qty"], dueDate:["duedate","due","needdate","requireddate"], status:["workorderstatus","status","state","wostatus"], customer:["customername","customer","client"], unitsProduced:["unitsproduced","produced","completed"], unitsRemaining:["unitsremaining","remaining","balance"], unitsPerHour:["standardunitsperhour","unitsperhour","rateperhour","rate"], standardPeople:["standardpeople","people","crew","headcount"], plannedStart:["plannedstart","startdate","planstart"], plannedEnd:["plannedend","enddate","planend"], reference1:["reference1","ref1","notes","reference"] };
export const PO_PAT = { material:["material","materialcode","itemcode","sku","item","partnumber","materialdescription"], description:["description","desc","name","materialdescription"], qty:["quantity","qty","orderqty","poqty","ordered"], unitPrice:["unitprice","price","rate","cost"], poNumber:["ponumber","po","purchaseorder","documentnumber"] };
