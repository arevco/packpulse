import { useTheme } from "../theme";

export function useStyles() {
  const { C, sans, mono } = useTheme();
  const hPad = "clamp(8px, 2.8vw, 12px)";
  const vPad = "clamp(7px, 1.8vw, 8px)";
  const hPadDetail = "clamp(7px, 2.4vw, 10px)";
  const vPadDetail = "clamp(6px, 1.6vw, 7px)";
  const fBody = "clamp(12px, 2.9vw, 13px)";
  const fHead = "clamp(11px, 2.6vw, 12px)";

  const thBase = { padding:vPad + " " + hPad, textAlign:"left", fontSize:fHead, fontWeight:600, fontFamily:sans, letterSpacing:0.2, borderBottom:"1px solid "+C.border, whiteSpace:"nowrap" };
  const tdBase = { padding:vPad + " " + hPad, fontSize:fBody, lineHeight:1.25 };

  const thC = active => Object.assign({}, thBase, { color:active?C.accent:C.dim, cursor:"pointer", userSelect:"none" });
  const thS = Object.assign({}, thBase, { color:C.dim });
  const tdN = Object.assign({}, tdBase, { fontFamily:sans, color:C.text });
  const tdM = Object.assign({}, tdBase, { fontFamily:mono, color:C.text });
  const tdToggle = { padding:"0 " + hPadDetail, width:26, textAlign:"center", fontSize:fBody, color:C.dim, whiteSpace:"nowrap" };

  const thDS = { padding:vPadDetail + " " + hPadDetail, textAlign:"left", fontSize:fBody, fontWeight:600, fontFamily:sans, letterSpacing:0.2, color:C.dim, borderBottom:"1px solid "+C.border };
  const tdDN = { padding:vPadDetail + " " + hPadDetail, fontSize:fBody, fontFamily:sans, color:C.text, lineHeight:1.25 };
  const tdDM = { padding:vPadDetail + " " + hPadDetail, fontSize:fBody, fontFamily:mono, color:C.text, lineHeight:1.25 };

  const truncate = maxWidth => ({ maxWidth:maxWidth, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" });
  const inp = { padding:"6px 10px", background:C.surface, border:"1px solid "+C.border, borderRadius:6, color:C.bright, fontFamily:sans, fontSize:13 };
  const sel = Object.assign({}, inp, { cursor:"pointer" });
  const pill = on => ({ padding:"4px 10px", borderRadius:16, border:"1px solid "+(on?C.accentLine:C.border), background:on?C.accentSoft:"transparent", color:on?C.accent:C.dim, fontFamily:sans, fontSize:13, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap" });
  return { thC, thS, tdN, tdM, tdToggle, thDS, tdDN, tdDM, truncate, inp, sel, pill };
}
