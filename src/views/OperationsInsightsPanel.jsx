import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { useTheme } from "../theme";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { DatePicker } from "../components/ui/date-picker";
import TableShell from "../components/ui/table-shell";
import ProductionView from "./ProductionView";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

var moneyCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1
});

var moneyWholeFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function fmtMoneyCompact(v) {
  return moneyCompactFormatter.format(safeNum(v));
}

function fmtMoney(v) {
  return moneyWholeFormatter.format(safeNum(v));
}

function fmtCasesPerProductionMin(v) {
  return safeNum(v).toFixed(2) + " cs/span min";
}

function OperationsDailyTotalTooltipContent(props) {
  var active = props.active;
  var payload = props.payload;
  var label = props.label;
  var config = props.config || {};
  if (!active || !payload || !payload.length) return null;
  var rows = payload.filter(function(item) { return String(item && item.dataKey || "") !== "plan"; });
  if (!rows.length) return null;
  var sourceRow = rows[0] && rows[0].payload ? rows[0].payload : {};
  var total = safeNum(sourceRow.total);
  return (
    <div className="min-w-[170px] rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-[rgb(var(--foreground))]">{label}</div>
      <div className="space-y-1">
        {rows.map(function(item, idx) {
          var key = String(item.dataKey || "");
          var cfg = config[key] || {};
          var name = cfg.label || item.name || key;
          var color = item.color || cfg.color || "rgb(var(--muted))";
          return (
            <div key={key + "-" + idx} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[rgb(var(--muted))]">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                {name}
              </span>
              <span className="font-semibold text-[rgb(var(--foreground))] [font-variant-numeric:tabular-nums]">
                {Math.round(safeNum(item.value)).toLocaleString()}
              </span>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[rgb(var(--muted))]">
            <span className="h-2 w-2 rounded-sm bg-[rgb(var(--foreground))]" />
            Daily Total
          </span>
          <span className="font-semibold text-[rgb(var(--foreground))] [font-variant-numeric:tabular-nums]">
            {Math.round(total).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function OperationsInsightsPanel({
  laborActuals,
  showProductionJobsLoading,
  showProductionJobsError,
  serverProductionSegments,
  revenuePerCaseForRow,
  dailyPerfRange,
  setDailyPerfStart,
  setDailyPerfEnd,
  dailyEconomicsRows,
  dailyEconomicsChartConfig,
  dailyPlanVsActual,
  dailyChartConfig,
  shiftPlanVsActual,
  shiftChartConfig,
  skuMixMode,
  setSkuMixMode,
  skuMixByDay,
  skuMixChartConfig,
  productionJobLeaderboard,
  showProductionLines,
  setShowProductionLines,
  lineScoreboard,
  showLossPriorities,
  setShowLossPriorities,
  evoconInsights
}) {
  const { C, mono } = useTheme();

  return (
    <>
      <Card className="px-4 py-4">
        <div className="mb-2 text-sm font-semibold">Production Jobs</div>
        {laborActuals.status === "missing_labor_events_table" && (
          <div className="mb-3 text-xs text-[rgb(var(--muted))]">
            Labor actuals are not enabled yet. Run `docs/supabase-labor-events.sql` in Supabase.
          </div>
        )}
        {showProductionJobsLoading ? (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-4 text-sm text-[rgb(var(--muted))]">
            Loading labor-matched production jobs...
          </div>
        ) : showProductionJobsError ? (
          <div className="rounded-xl border border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-4 text-sm text-[rgb(var(--danger))]">
            Could not load labor actuals for Production Jobs right now.
          </div>
        ) : (
          <ProductionView
            productionSegments={serverProductionSegments}
            laborActuals={laborActuals}
            laborDataRaw={[]}
            resolveRevenueForRow={revenuePerCaseForRow}
          />
        )}
      </Card>

      <Card className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Daily Output & Economics</div>
            <div className="text-xs text-[rgb(var(--muted))]">
              Cases produced, revenue, labor cost, and labor margin by day. Default window is the latest 30 days.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <DatePicker value={dailyPerfRange.start} onChange={setDailyPerfStart} className="h-9 w-[132px]" />
            <span className="text-xs text-[rgb(var(--muted))] whitespace-nowrap">-</span>
            <DatePicker value={dailyPerfRange.end} onChange={setDailyPerfEnd} className="h-9 w-[132px]" />
            <Button
              variant="outline"
              size="sm"
              onClick={function() {
                setDailyPerfStart("");
                setDailyPerfEnd("");
              }}
            >
              Last 30D
            </Button>
          </div>
        </div>
        {dailyEconomicsRows.length ? (
          <ChartContainer config={dailyEconomicsChartConfig} className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyEconomicsRows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                <XAxis
                  dataKey="date"
                  tickFormatter={function(v) { return String(v || "").slice(5); }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                  tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="cases"
                  width={62}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                  tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="dollars"
                  orientation="right"
                  width={72}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={function(v) { return fmtMoneyCompact(v); }}
                  tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                />
                <ChartTooltip
                  cursor={{ stroke: "rgb(var(--border))", strokeDasharray: "3 3" }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={function(value) { return value; }}
                      formatter={function(value, _name, item) {
                        var key = String(item && item.dataKey || "");
                        if (key === "revenue" || key === "labor" || key === "margin") return fmtMoney(value);
                        return Math.round(safeNum(value)).toLocaleString();
                      }}
                    />
                  }
                />
                <Line
                  yAxisId="cases"
                  type="monotone"
                  dataKey="cases"
                  stroke={dailyEconomicsChartConfig.cases.color}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="dollars"
                  type="monotone"
                  dataKey="revenue"
                  stroke={dailyEconomicsChartConfig.revenue.color}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="dollars"
                  type="monotone"
                  dataKey="labor"
                  stroke={dailyEconomicsChartConfig.labor.color}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="dollars"
                  type="monotone"
                  dataKey="margin"
                  stroke={dailyEconomicsChartConfig.margin.color}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        ) : (
          <div className="h-60 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[15rem]">No daily production or labor data in selected window.</div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: dailyEconomicsChartConfig.cases.color }} />Cases Produced</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: dailyEconomicsChartConfig.revenue.color }} />Revenue</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: dailyEconomicsChartConfig.labor.color }} />Labor Cost</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: dailyEconomicsChartConfig.margin.color }} />Labor Margin</span>
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Daily Production Yield</div>
          {dailyPlanVsActual.rows.length ? (
            <ChartContainer config={dailyChartConfig} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyPlanVsActual.rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={function(v) { return String(v || "").slice(5); }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={16}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <YAxis
                    width={62}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgb(var(--surface))" }}
                    content={<OperationsDailyTotalTooltipContent config={dailyChartConfig} />}
                  />
                  {(dailyPlanVsActual.lineSeries || []).map(function(line, idx) {
                    var lastIdx = (dailyPlanVsActual.lineSeries || []).length - 1;
                    var radius = idx === 0 ? [0, 0, 4, 4] : idx === lastIdx ? [4, 4, 0, 0] : [0, 0, 0, 0];
                    return (
                      <Bar
                        key={line.key}
                        stackId="line"
                        dataKey={line.key}
                        fill={line.color}
                        radius={radius}
                        maxBarSize={26}
                      />
                    );
                  })}
                  <Line
                    type="monotone"
                    dataKey="plan"
                    stroke={dailyChartConfig.plan.color}
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-52 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[13rem]">No daily production data in selected window.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            {(dailyPlanVsActual.lineSeries || []).map(function(line) {
              return (
                <span key={line.key} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: line.color }} />
                  {line.label}
                </span>
              );
            })}
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Forecast daily plan</span>
          </div>
        </Card>
        <Card className="px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Shift Mix by Day</div>
          {shiftPlanVsActual.rows.length ? (
            <ChartContainer config={shiftChartConfig} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={shiftPlanVsActual.rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={function(v) { return String(v || "").slice(5); }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={16}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <YAxis
                    width={62}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgb(var(--surface))" }}
                    content={<OperationsDailyTotalTooltipContent config={shiftChartConfig} />}
                  />
                  {["s1", "s2", "un"].map(function(key, idx, arr) {
                    var lastIdx = arr.length - 1;
                    var radius = idx === 0 ? [0, 0, 4, 4] : idx === lastIdx ? [4, 4, 0, 0] : [0, 0, 0, 0];
                    return (
                      <Bar
                        key={key}
                        stackId="shift"
                        dataKey={key}
                        fill={shiftChartConfig[key].color}
                        radius={radius}
                        maxBarSize={26}
                      />
                    );
                  })}
                  <Line
                    type="monotone"
                    dataKey="plan"
                    stroke={shiftChartConfig.plan.color}
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-52 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[13rem]">No shift production data in selected window.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: shiftChartConfig.s1.color }} />Shift 1</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: shiftChartConfig.s2.color }} />Shift 2</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: shiftChartConfig.un.color }} />Unassigned</span>
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Forecast daily plan</span>
          </div>
        </Card>
        <Card className="px-4 py-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">SKU Mix by Day</div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant={skuMixMode === "type" ? "active" : "outline"} onClick={function() { setSkuMixMode("type"); }}>
                SKU Type
              </Button>
              <Button size="sm" variant={skuMixMode === "item" ? "active" : "outline"} onClick={function() { setSkuMixMode("item"); }}>
                Item #
              </Button>
            </div>
          </div>
          {skuMixByDay.rows.length ? (
            <ChartContainer config={skuMixChartConfig} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={skuMixByDay.rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={function(v) { return String(v || "").slice(5); }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={16}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <YAxis
                    width={62}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgb(var(--surface))" }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={function(value) { return value; }}
                        formatter={function(value) { return Math.round(safeNum(value)); }}
                      />
                    }
                  />
                  {(skuMixByDay.series || []).map(function(s, idx) {
                    var lastIdx = (skuMixByDay.series || []).length - 1;
                    var radius = idx === 0 ? [0, 0, 4, 4] : idx === lastIdx ? [4, 4, 0, 0] : [0, 0, 0, 0];
                    return (
                      <Bar
                        key={s.key}
                        stackId="skuMix"
                        dataKey={s.key}
                        fill={s.color}
                        radius={radius}
                        maxBarSize={30}
                      />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-52 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[13rem]">No SKU mix data in selected window.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            {(skuMixByDay.series || []).map(function(s) {
              return (
                <span key={s.key} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Production Job Leaderboard</div>
            <div className="text-xs text-[rgb(var(--muted))]">
              Ranked with yield-first weighting in the selected window: total cases carry more weight, then cases per measured span minute. Each row uses actual Nulogy job start/stop timestamps when available; otherwise it uses Observed FG Output Span from first-to-last produced timestamps.
            </div>
          </div>
          <div className="text-xs text-[rgb(var(--muted))]">
            {productionJobLeaderboard.qualifiedCount.toLocaleString()} qualified job run{productionJobLeaderboard.qualifiedCount === 1 ? "" : "s"}{productionJobLeaderboard.actualWindowCount > 0 ? (" · " + productionJobLeaderboard.actualWindowCount.toLocaleString() + " actual job window" + (productionJobLeaderboard.actualWindowCount === 1 ? "" : "s")) : ""}{productionJobLeaderboard.observedSpanCount > 0 ? (" · " + productionJobLeaderboard.observedSpanCount.toLocaleString() + " Observed FG Output Span" + (productionJobLeaderboard.observedSpanCount === 1 ? "" : "s")) : ""}
          </div>
        </div>

        {productionJobLeaderboard.qualifiedCount ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {[
              { key: "best", label: "Top 5 Best Job Runs", rows: productionJobLeaderboard.best, tone: "success", icon: TrendingUp },
              { key: "worst", label: "Top 5 Worst Job Runs", rows: productionJobLeaderboard.worst, tone: "danger", icon: TrendingDown }
            ].map(function(section) {
              var Icon = section.icon;
              var headerTone = section.tone === "success"
                ? "text-[rgb(var(--success))]"
                : "text-[rgb(var(--danger))]";
              return (
                <div key={section.key} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))]">
                  <div className="flex items-center gap-2 border-b border-[rgb(var(--border))] px-3 py-2">
                    <Icon className={"h-4 w-4 " + headerTone} />
                    <div className="text-sm font-semibold">{section.label}</div>
                  </div>
                  <div className="divide-y divide-[rgb(var(--border))]">
                    {section.rows.map(function(row, idx) {
                      return (
                        <div key={row.key} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className={"inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold " + (section.tone === "success" ? "bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]" : "bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]")}>
                                #{idx + 1}
                              </span>
                              <span className="truncate text-sm font-semibold text-[rgb(var(--foreground))]">{row.itemCode}</span>
                              <span className="inline-flex rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2 py-0.5 text-[10px] font-medium text-[rgb(var(--muted))]">{row.date}</span>
                            </div>
                            <div className="truncate text-xs text-[rgb(var(--muted))]">
                              Job {row.jobId} · WO {row.workOrder} · {row.line}
                            </div>
                            <div className="truncate text-[11px] text-[rgb(var(--muted))]">{row.itemDescription || "--"}</div>
                          </div>
                          <div className="shrink-0 text-right text-xs [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>
                            <div className={"text-sm font-semibold " + headerTone}>{fmtCasesPerProductionMin(row.casesPerProductionMinute)}</div>
                            <div className="text-[rgb(var(--muted))]">{Math.round(safeNum(row.casesProduced)).toLocaleString()} cs · {Math.round(safeNum(row.productionMinutes)).toLocaleString()} span min</div>
                            <div className="text-[rgb(var(--muted))]">{row.windowLabel}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-4 text-sm text-[rgb(var(--muted))]">
            No production job runs with a measurable actual job window or Observed FG Output Span met the leaderboard minimums in this window.
          </div>
        )}
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="px-4 py-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Production Lines</div>
              <div className="text-xs text-[rgb(var(--muted))]">
                Output leaders and movers for the selected window, {lineScoreboard.compareLabel}.
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={function() { setShowProductionLines(function(v) { return !v; }); }}>
              <span className="mr-1">{showProductionLines ? "▾" : "▸"}</span>
              {showProductionLines ? "Hide" : "Show"}
            </Button>
          </div>
          {showProductionLines ? (
          <>
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Leader</div>
              <div className="mt-1 text-sm font-semibold">
                {lineScoreboard.leader ? lineScoreboard.leader.line : "No production"}
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {lineScoreboard.leader
                  ? (Math.round(lineScoreboard.leader.units).toLocaleString() + " cs · " + lineScoreboard.leader.sharePct + "%")
                  : "No line output in this window."}
              </div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Lift</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                {lineScoreboard.biggestUp ? <TrendingUp className="h-3.5 w-3.5 text-[rgb(var(--success))]" /> : null}
                <span>{lineScoreboard.biggestUp ? lineScoreboard.biggestUp.line : "No lift"}</span>
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {lineScoreboard.biggestUp
                  ? ("+" + Math.round(lineScoreboard.biggestUp.deltaUnits).toLocaleString() + " cs")
                  : ("No positive movement " + lineScoreboard.compareLabel + ".")}
              </div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Watch</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                {lineScoreboard.biggestDown ? <TrendingDown className="h-3.5 w-3.5 text-[rgb(var(--danger))]" /> : null}
                <span>{lineScoreboard.biggestDown ? lineScoreboard.biggestDown.line : "No lagging line"}</span>
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {lineScoreboard.biggestDown
                  ? (Math.round(lineScoreboard.biggestDown.deltaUnits).toLocaleString() + " cs")
                  : ("No negative movement " + lineScoreboard.compareLabel + ".")}
              </div>
            </div>
          </div>
          <TableShell>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Cases</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Delta</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">State</th>
                </tr>
              </thead>
              <tbody>
                {lineScoreboard.rows.slice(0, 6).map(function(r) {
                  var TrendIcon = r.trend === "up" ? TrendingUp : r.trend === "down" ? TrendingDown : Minus;
                  var deltaTone = r.trend === "up"
                    ? "text-[rgb(var(--success))]"
                    : r.trend === "down"
                      ? "text-[rgb(var(--danger))]"
                      : "text-[rgb(var(--muted))]";
                  var statusTone = r.status === "Leading"
                    ? "border-[rgb(var(--accent))] bg-[color-mix(in_oklab,rgb(var(--accent))_8%,white)] text-[rgb(var(--accent))]"
                    : r.status === "Improving"
                      ? "border-[rgb(var(--success-line))] bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]"
                      : r.status === "Softening" || r.status === "Idle"
                        ? "border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]"
                        : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]";
                  return (
                    <tr key={r.line} style={{ borderBottom: "1px solid " + C.border }}>
                      <td className="px-2 py-2 text-sm">
                        <div>{r.line}</div>
                        <div className="text-[11px] text-[rgb(var(--muted))]">{r.sharePct}% share</div>
                      </td>
                      <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{Math.round(r.units).toLocaleString()}</td>
                      <td className={"px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums] " + deltaTone} style={{ fontFamily: mono }}>
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <TrendIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {r.deltaUnits > 0 ? "+" : ""}{Math.round(r.deltaUnits).toLocaleString()}
                            {r.priorUnits > 0 ? " (" + (r.deltaPct > 0 ? "+" : "") + r.deltaPct + "%)" : ""}
                          </span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <span className={"inline-flex rounded-full border px-2 py-1 text-[11px] font-medium " + statusTone}>{r.status}</span>
                      </td>
                    </tr>
                  );
                })}
                {!lineScoreboard.rows.length && <tr><td colSpan={4} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No line output data in this window.</td></tr>}
              </tbody>
            </table>
          </TableShell>
          </>
          ) : null}
        </Card>

        <Card className="px-4 py-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Loss Priorities</div>
              <div className="text-xs text-[rgb(var(--muted))]">
                Controllable Evocon loss hotspots, {evoconInsights.compareLabel}.
                {evoconInsights.latestDate ? " Latest day: " + evoconInsights.latestDate + "." : ""}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={function() { setShowLossPriorities(function(v) { return !v; }); }}>
              <span className="mr-1">{showLossPriorities ? "▾" : "▸"}</span>
              {showLossPriorities ? "Hide" : "Show"}
            </Button>
          </div>
          {showLossPriorities ? (!evoconInsights.hasData ? (
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-8 text-center text-sm text-[rgb(var(--muted))]">
              No Evocon rows in selected window. Sync Evocon and/or adjust dates.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                {evoconInsights.priorityCards.slice(0, 3).map(function(card) {
                  var rawDelta = safeNum(card.delta);
                  var hasDelta = card.delta != null;
                  var deltaIsGood = card.goodWhenDown ? rawDelta < 0 : rawDelta > 0;
                  var deltaIsBad = card.goodWhenDown ? rawDelta > 0 : rawDelta < 0;
                  var DeltaIcon = rawDelta > 0 ? TrendingUp : rawDelta < 0 ? TrendingDown : Minus;
                  var deltaLabel = deltaIsGood ? "Improving" : deltaIsBad ? "Worsening" : "Flat";
                  var deltaTone = deltaIsGood
                    ? "text-[rgb(var(--success))]"
                    : deltaIsBad
                      ? "text-[rgb(var(--danger))]"
                      : "text-[rgb(var(--muted))]";
                  var valueTone = card.tone === "danger"
                    ? "text-[rgb(var(--danger))]"
                    : "text-[rgb(var(--foreground))]";
                  return (
                    <div key={card.label} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">{card.label}</div>
                      <div className={"mt-1 text-lg font-bold [font-variant-numeric:tabular-nums] " + valueTone} style={{ fontFamily: mono }}>{card.value}</div>
                      <div className="text-xs text-[rgb(var(--muted))]">{card.subcopy}</div>
                      {hasDelta ? (
                        <div className={"mt-2 inline-flex items-center gap-1 text-[11px] font-medium " + deltaTone}>
                          <DeltaIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {deltaLabel + " · "}
                            {rawDelta > 0 ? "+" : ""}{rawDelta.toLocaleString()}
                            {card.deltaPct != null ? " (" + (safeNum(card.deltaPct) > 0 ? "+" : "") + card.deltaPct + "%)" : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {(evoconInsights.actions && evoconInsights.actions[0]) ? (
                <div className="rounded-md border border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2">
                  <div className="text-sm font-semibold text-[rgb(var(--danger))]">{evoconInsights.actions[0].title}</div>
                  <div className="text-xs text-[rgb(var(--muted))]">{evoconInsights.actions[0].detail}</div>
                </div>
              ) : null}
              {(evoconInsights.shiftCards && evoconInsights.shiftCards[0]) ? (
                <div className="rounded-md border border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] px-3 py-2 text-xs text-[rgb(var(--foreground))]">
                  Worst shift: <span className="font-semibold">{evoconInsights.shiftCards[0].shift}</span> · {evoconInsights.shiftCards[0].lossMin.toLocaleString()} loss min · {evoconInsights.shiftCards[0].driverLabel}
                </div>
              ) : null}
              <TableShell>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.raised }}>
                      <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Loss</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Driver</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Focus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evoconInsights.byLine.slice(0, 6).map(function(r) {
                      var focusTone = r.focus === "Raise stop coding"
                        ? "border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]"
                        : r.focus === "Recover speed"
                          ? "border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] text-[rgb(var(--warning))]"
                          : r.focus === "Reduce stops" || r.focus === "Fix technical losses"
                            ? "border-[rgb(var(--accent))] bg-[color-mix(in_oklab,rgb(var(--accent))_8%,white)] text-[rgb(var(--accent))]"
                            : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]";
                      var statusTone = r.status === "Hotspot" || r.status === "Blind spot" || r.status === "Worsening"
                        ? "text-[rgb(var(--danger))]"
                        : r.status === "Improving"
                          ? "text-[rgb(var(--success))]"
                          : "text-[rgb(var(--muted))]";
                      return (
                        <tr key={r.line} style={{ borderBottom: "1px solid " + C.border }}>
                          <td className="px-2 py-2 text-sm">
                            <div>{r.line}</div>
                            <div className={"text-[11px] " + statusTone}>{r.status} · {r.lossSharePct}% share</div>
                          </td>
                          <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{r.lossMin.toLocaleString()}</td>
                          <td className="px-2 py-2 text-sm">
                            <div>{r.driverLabel}</div>
                            <div className="text-[11px] text-[rgb(var(--muted))]">{r.driverSharePct}% of line loss</div>
                          </td>
                          <td className="px-2 py-2 text-right text-sm">
                            <span className={"inline-flex rounded-full border px-2 py-1 text-[11px] font-medium " + focusTone}>{r.focus}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {!evoconInsights.byLine.length && <tr><td colSpan={4} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No line loss data in this window.</td></tr>}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )) : null}
        </Card>
      </div>
    </>
  );
}
