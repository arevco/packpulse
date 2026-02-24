import { useCallback } from "react";
import { useTheme } from "../theme";
import { parseCsvText, readFileAsText, readWorkbook, workbookFirstSheetToJson } from "../utils/fileParsers";

export default function FileUploader({ label, onData, uploaded, fileName, subtitle, acceptTypes, parseWorkbook }) {
  const { C, sans } = useTheme();
  const accept = acceptTypes || ".csv";
  const handleFile = useCallback(async file => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "pdf") {
      window.alert("PDF selected. Automatic PO parsing currently supports CSV/XLSX only. Please export the PDF to CSV/XLSX and upload that file.");
      return;
    }
    try {
      if (ext === "xlsx" || ext === "xls") {
        if (parseWorkbook) {
          const wb = await readWorkbook(file);
          onData(await parseWorkbook(wb), file.name);
        } else {
          onData(await workbookFirstSheetToJson(file), file.name);
        }
      } else {
        const text = await readFileAsText(file);
        onData(await parseCsvText(text), file.name);
      }
    } catch (err) {
      console.error(err);
    }
  }, [onData, parseWorkbook]);
  return (
    <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
      style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", border:"1px solid " + (uploaded ? C.okLine : C.border), borderRadius:8, cursor:"pointer", background:uploaded ? C.okSoft : C.surface }}>
      <input type="file" accept={accept} style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
      <div style={{ width:28, height:28, borderRadius:6, background:uploaded ? C.ok : C.raised, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:uploaded ? "#fff" : C.dim, fontWeight:700, flexShrink:0 }}>{uploaded ? "\u2713" : "+"}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:15, fontWeight:600, color:uploaded ? C.ok : C.bright, fontFamily:sans }}>{label}</div>
        <div style={{ fontSize:13, color:C.dim, fontFamily:sans, marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{uploaded ? fileName : subtitle || ("Drop " + accept.replace(/\./g,"").toUpperCase() + " or click")}</div>
      </div>
    </label>
  );
}
