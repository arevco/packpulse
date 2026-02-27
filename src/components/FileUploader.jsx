import { useCallback } from "react";
import { useTheme } from "../theme";
import { parseCsvText, readFileAsText, readWorkbook, workbookFirstSheetToJson } from "../utils/fileParsers";
import { cn } from "../lib/utils";

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
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md border px-3.5 py-3",
        uploaded ? "border-[rgb(var(--success))]/40 bg-[color-mix(in_oklab,rgb(var(--success))_10%,white)]" : "border-[rgb(var(--border))] bg-[rgb(var(--surface))]"
      )}>
      <input type="file" accept={accept} style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[15px] font-bold", uploaded ? "bg-[rgb(var(--success))] text-white" : "bg-[rgb(var(--surface))] text-[rgb(var(--muted))]")}>{uploaded ? "\u2713" : "+"}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold" style={{ color:uploaded ? C.ok : C.bright, fontFamily:sans }}>{label}</div>
        <div className="mt-px overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[rgb(var(--muted))]" style={{ fontFamily:sans }}>{uploaded ? fileName : subtitle || ("Drop " + accept.replace(/\./g,"").toUpperCase() + " or click")}</div>
      </div>
    </label>
  );
}
