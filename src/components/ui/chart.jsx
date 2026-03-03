import * as React from "react";
import { Tooltip as RechartsTooltip } from "recharts";

import { cn } from "../../lib/utils";

const ChartContext = React.createContext(null);

function ChartContainer({ id, className, children, config }) {
  const chartId = React.useId();
  const dataChart = "chart-" + (id || chartId.replace(/:/g, ""));
  const style = React.useMemo(() => {
    const vars = {};
    Object.entries(config || {}).forEach(function(entry) {
      const key = entry[0];
      const item = entry[1] || {};
      if (!item.color) return;
      vars["--color-" + key] = item.color;
    });
    return vars;
  }, [config]);

  return (
    <ChartContext.Provider value={{ config: config || {} }}>
      <div data-chart={dataChart} className={cn("w-full", className)} style={style}>
        {children}
      </div>
    </ChartContext.Provider>
  );
}

function ChartTooltip(props) {
  return <RechartsTooltip {...props} />;
}

function ChartTooltipContent({ active, payload, label, labelFormatter, formatter }) {
  const ctx = React.useContext(ChartContext);
  const config = (ctx && ctx.config) || {};
  if (!active || !payload || !payload.length) return null;
  const title = labelFormatter ? labelFormatter(label) : label;
  return (
    <div className="min-w-[170px] rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-[rgb(var(--foreground))]">{title}</div>
      <div className="space-y-1">
        {payload.map(function(item, idx) {
          const key = String(item.dataKey || "");
          const cfg = config[key] || {};
          const name = cfg.label || item.name || key;
          const color = item.color || cfg.color || "rgb(var(--muted))";
          const value = formatter ? formatter(item.value, item.name, item, idx) : item.value;
          return (
            <div key={key + "-" + idx} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[rgb(var(--muted))]">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                {name}
              </span>
              <span className="font-semibold text-[rgb(var(--foreground))] [font-variant-numeric:tabular-nums]">
                {typeof value === "number" ? Math.round(value).toLocaleString() : value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent };
