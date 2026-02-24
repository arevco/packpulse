export function readFileAsArrayBuffer(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e && e.target ? e.target.result : null); };
    reader.onerror = function(err) { reject(err); };
    reader.readAsArrayBuffer(file);
  });
}

export function readFileAsText(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e && e.target ? e.target.result : ""); };
    reader.onerror = function(err) { reject(err); };
    reader.readAsText(file);
  });
}

export async function parseCsvText(text) {
  const papaModule = await import("papaparse");
  const Papa = papaModule.default || papaModule;
  return Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false }).data;
}

export async function readWorkbook(file) {
  const buffer = await readFileAsArrayBuffer(file);
  const xlsxModule = await import("xlsx");
  const XLSX = xlsxModule.default || xlsxModule;
  return XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
}

export async function workbookFirstSheetToJson(file) {
  const wb = await readWorkbook(file);
  const xlsxModule = await import("xlsx");
  const XLSX = xlsxModule.default || xlsxModule;
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}
