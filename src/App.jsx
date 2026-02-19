import ProductionReadiness from "./PackPulse";
import { Analytics } from "@vercel/analytics/react";

export default function App() {
  return (
    <>
      <ProductionReadiness />
      <Analytics />
    </>
  );
}
