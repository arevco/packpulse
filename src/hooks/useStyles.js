import { useTheme } from "../theme";

export function useStyles() {
  const { C, sans, mono } = useTheme();
  const thC = active => ({ padding:"10px 14px", textAlign:"left", fontSize:12, fontWeight:600, fontFamily:sans, letterSpacing:0.6, color:active?C.accent:C.dim, borderBottom:"1px solid "+C.border, cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", textTransform:"uppercase" });
  const thS = { padding:"10px 14px", textAlign:"left", fontSize:12, fontWeight:600, fontFamily:sans, letterSpacing:0.6, color:C.dim, borderBottom:"1px solid "+C.border, whiteSpace:"nowrap", textTransform:"uppercase" };
  const tdN = { padding:"10px 14px", fontSize:14, fontFamily:sans, color:C.text };
  const tdM = { padding:"10px 14px", fontSize:14, fontFamily:mono, color:C.text };
  const inp = { padding:"6px 12px", background:C.surface, border:"1px solid "+C.border, borderRadius:6, color:C.bright, fontFamily:sans, fontSize:14 };
  const sel = Object.assign({}, inp, { cursor:"pointer" });
  const pill = on => ({ padding:"4px 12px", borderRadius:16, border:"1px solid "+(on?C.accentLine:C.border), background:on?C.accentSoft:"transparent", color:on?C.accent:C.dim, fontFamily:sans, fontSize:14, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap" });
  return { thC, thS, tdN, tdM, inp, sel, pill };
}
