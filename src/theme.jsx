import { createContext, useContext, useState } from "react";

const FONTS_CSS = "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";
const sans = "'IBM Plex Sans', -apple-system, sans-serif";
const mono = "'IBM Plex Mono', monospace";

const THEMES = {
  dark: {
    bg:"#101114",surface:"#18191e",raised:"#1e2026",border:"#2a2c34",
    text:"#a8adb8",dim:"#5c6070",bright:"#e2e5eb",
    accent:"#5b8def",accentSoft:"rgba(91,141,239,0.10)",accentLine:"rgba(91,141,239,0.30)",
    ok:"#3dbd7d",okSoft:"rgba(61,189,125,0.10)",okLine:"rgba(61,189,125,0.25)",
    warn:"#e0a030",warnSoft:"rgba(224,160,48,0.10)",warnLine:"rgba(224,160,48,0.25)",
    bad:"#e05555",badSoft:"rgba(224,85,85,0.10)",badLine:"rgba(224,85,85,0.25)",
    hover:"rgba(255,255,255,0.03)",
  },
  light: {
    bg:"#f3f4f6",surface:"#ffffff",raised:"#f8f9fb",border:"#e2e4ea",
    text:"#505868",dim:"#8c93a4",bright:"#1c2030",
    accent:"#3b6fd8",accentSoft:"rgba(59,111,216,0.07)",accentLine:"rgba(59,111,216,0.22)",
    ok:"#1c9858",okSoft:"rgba(28,152,88,0.07)",okLine:"rgba(28,152,88,0.22)",
    warn:"#b88510",warnSoft:"rgba(184,133,16,0.07)",warnLine:"rgba(184,133,16,0.22)",
    bad:"#cc3838",badSoft:"rgba(204,56,56,0.07)",badLine:"rgba(204,56,56,0.22)",
    hover:"rgba(0,0,0,0.025)",
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState("light");
  const C = THEMES[theme];
  return (
    <ThemeContext.Provider value={{ C, theme, setTheme, sans, mono, FONTS_CSS }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
