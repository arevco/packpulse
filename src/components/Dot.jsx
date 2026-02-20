import { useTheme } from "../theme";

export default function Dot({ status }) {
  const { C } = useTheme();
  var c = status === "ready" ? C.ok : status === "partial" ? C.warn : status === "nobom" ? C.accent : C.bad;
  var l = status === "ready" ? "Ready" : status === "partial" ? "Partial" : status === "nobom" ? "No BOM" : "Blocked";
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:13, fontFamily:"'IBM Plex Sans', -apple-system, sans-serif", fontWeight:500, color:c }}><span style={{ width:6, height:6, borderRadius:"50%", background:c }} />{l}</span>;
}
