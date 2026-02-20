import { ThemeProvider } from "./theme";
import ProductionReadiness from "./PackPulse";

export default function App() {
  return (
    <ThemeProvider>
      <ProductionReadiness />
    </ThemeProvider>
  );
}
