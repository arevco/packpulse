import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme";
import ProductionReadiness from "./PackPulse";

export default function App() {
  var [queryClient] = useState(function() {
    return new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 30 * 60 * 1000,
          retry: 1,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false
        }
      }
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ProductionReadiness />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
