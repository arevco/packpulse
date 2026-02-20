import * as Papa from "papaparse";

export function parseCSV(text) { return Papa.parse(text, { header:true, skipEmptyLines:true, dynamicTyping:false }).data; }
export function safeNum(v) { if (v == null || v === "") return 0; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
export function normalizeStr(s) { return String(s || "").replace(/[^a-z0-9]/gi, "").toLowerCase(); }
export function fmtDate(v) { if (!v) return "--"; var d = v instanceof Date ? v : new Date(v); if (isNaN(d)) return String(v); return (d.getMonth()+1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(-2); }
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

export const INV_PAT = { sku:["itemcode","sku","item","material","partnumber"], description:["description","desc","itemname","name"], qtyOnHand:["qtyonhand","onhand","basequantity","available","stock","instock","quantity"] };
export const BOM_PAT = { bomId:["finishedgoodcode","bomid","parentsku","parent","fgcode"], componentSku:["subcomponentcode","componentsku","childsku","component","material"], description:["subcomponentdescription","componentdescription","itemdescription","materialdescription","subcomponentname","componentname","description","desc"], qtyPer:["qtyper","quantity","ratio","usage","per"], substituteFor:["substitutefor","altfor","replacementfor","subfor"], priority:["priority","prio","rank","preference"] };
export const WO_PAT = { woNumber:["workordercode","wonum","wonumber","workorder","wo"], productSku:["itemcode","productsku","sku","material","fgsku"], qtyToProduce:["unitsexpected","qtytoproduce","orderqty","quantity","qty"], dueDate:["duedate","due","needdate","requireddate"], status:["workorderstatus","status","state","wostatus"], customer:["customername","customer","client"], unitsProduced:["unitsproduced","produced","completed"], unitsRemaining:["unitsremaining","remaining","balance"], unitsPerHour:["standardunitsperhour","unitsperhour","rateperhour","rate"], standardPeople:["standardpeople","people","crew","headcount"], plannedStart:["plannedstart","startdate","planstart"], plannedEnd:["plannedend","enddate","planend"], reference1:["reference1","ref1","notes","reference"] };
export const PO_PAT = { material:["material","materialcode","itemcode","sku","item","partnumber","materialdescription"], description:["description","desc","name","materialdescription"], qty:["quantity","qty","orderqty","poqty","ordered"], unitPrice:["unitprice","price","rate","cost"], poNumber:["ponumber","po","purchaseorder","documentnumber"] };
