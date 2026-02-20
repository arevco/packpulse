import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";

export default function POCheckView({ poCheck }) {
  const { C, sans, mono } = useTheme();
  const { thS, tdN, tdM } = useStyles();

  var safePoCheck = poCheck || {
    totalLines: 0,
    matched: 0,
    qtyMismatch: 0,
    missing: 0,
    totalPOQty: 0,
    totalWOQty: 0,
    poNum: "",
    lines: []
  };

  return (<div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:10, marginBottom:20 }}>
      {[
        {l:"PO Lines", v:safePoCheck.totalLines, c:C.bright},
        {l:"Matched", v:safePoCheck.matched, c:C.ok},
        {l:"Qty Mismatch", v:safePoCheck.qtyMismatch, c:C.warn},
        {l:"Missing WO", v:safePoCheck.missing, c:safePoCheck.missing>0?C.bad:C.ok},
        {l:"PO Total Qty", v:safePoCheck.totalPOQty.toLocaleString(), c:C.bright},
        {l:"WO Total Qty", v:safePoCheck.totalWOQty.toLocaleString(), c:safePoCheck.totalWOQty>=safePoCheck.totalPOQty?C.ok:C.warn}
      ].map(s => <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"14px 16px" }}>
        <div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
        <div style={{ fontSize:12, color:C.dim, marginTop:5, fontWeight:500, letterSpacing:0.1 }}>{s.l}</div>
      </div>)}
    </div>
    {safePoCheck.poNum && <div style={{ fontSize:13, color:C.dim, marginBottom:12 }}>PO# <span style={{ fontWeight:600, color:C.bright }}>{safePoCheck.poNum}</span></div>}
    <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr style={{ background:C.raised }}>
          {["Material","Description","Status","PO Qty","WO Qty","Diff","WOs","Produced"].map(h =>
            <th key={h} style={thS}>{h}</th>
          )}
        </tr></thead>
        <tbody>
          {safePoCheck.lines.map((ln, i) => {
            var sc = ln.status==="matched"?C.ok:ln.status==="qty_mismatch"?C.warn:C.bad;
            var sl = ln.status==="matched"?"\u2713 Matched":ln.status==="qty_mismatch"?"\u26A0 Qty Mismatch":"\u2717 Missing WO";
            return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{ln.material}</td>
              <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{ln.description || "--"}</td>
              <td style={Object.assign({}, tdN, { fontWeight:600, color:sc, whiteSpace:"nowrap" })}>{sl}</td>
              <td style={Object.assign({}, tdM, { color:C.bright })}>{ln.poQty.toLocaleString()}</td>
              <td style={Object.assign({}, tdM, { color:ln.woCount>0?C.bright:C.dim })}>{ln.woCount>0?ln.woTotalQty.toLocaleString():"--"}</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:ln.qtyDiff===0?C.dim:ln.qtyDiff>0?C.ok:C.bad })}>{ln.woCount>0?(ln.qtyDiff>0?"+":"")+ln.qtyDiff.toLocaleString():"--"}</td>
              <td style={Object.assign({}, tdM, { color:C.dim })}>{ln.woCount>0?ln.woCount:"--"}</td>
              <td style={Object.assign({}, tdM, { color:ln.woProduced>0?C.ok:C.dim })}>{ln.woProduced>0?ln.woProduced.toLocaleString():"--"}</td>
            </tr>;
          })}
          {safePoCheck.lines.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding:24, textAlign:"center", color:C.dim }}>
                No purchase order reconciliation data loaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>);
}
