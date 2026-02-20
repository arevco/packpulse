import { useTheme } from "../theme";

export default function ColumnMapper({ title, headers, mapping, onMappingChange, fields }) {
  const { C, sans, mono } = useTheme();
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:12, fontWeight:600, color:C.accent, fontFamily:mono, textTransform:"uppercase", letterSpacing:1.5, marginBottom:10 }}>{title}</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(190px, 1fr))", gap:8 }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={{ fontSize:13, color:C.dim, fontFamily:sans, display:"block", marginBottom:3 }}>{f.label}{f.required && <span style={{ color:C.bad }}> *</span>}</label>
            <select value={mapping[f.key] || ""} onChange={e => onMappingChange({ ...mapping, [f.key]: e.target.value })}
              style={{ width:"100%", padding:"7px 10px", borderRadius:6, border:"1px solid " + (mapping[f.key] ? C.accentLine : C.border), background:C.surface, color:C.bright, fontFamily:mono, fontSize:13, outline:"none" }}>
              <option value="">--</option>
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
