import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import TabsNav from "../components/ui/tabs-nav";
import { DatePicker } from "../components/ui/date-picker";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";
import { formatDescriptionForDisplay, safeNum, triggerDownload } from "../utils";

const SECTION_ORDER = ["inventory", "inbounds", "outbounds", "production", "consumption"];
const WINDOW_OPTIONS = [1, 7, 14, 30];

async function fetchJsonWithCredentials(url) {
  const response = await fetch(url, { credentials: "include" });
  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }
  return { response: response, body: body };
}

async function fetchReportingPacket(asOfDate, windowDays, customer) {
  const params = new URLSearchParams();
  if (asOfDate) params.set("asOf", asOfDate);
  params.set("windowDays", String(windowDays || 7));
  if (customer && customer !== "all") params.set("customer", customer);
  const result = await fetchJsonWithCredentials("/api/reporting/daily?" + params.toString());
  if (!result.response.ok) {
    throw new Error((result.body && (result.body.details || result.body.error)) || "Could not load reporting packet");
  }
  return result.body && typeof result.body === "object" ? result.body : {};
}

function todayIsoLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function formatDateLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return raw;
  return Number(parts[2]) + "/" + Number(parts[3]) + "/" + parts[1].slice(-2);
}

function csvCell(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function textCompare(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base", numeric: true });
}

function normalizeSearchValue(value) {
  return String(value || "").toLowerCase().trim();
}

function formatNumber(value) {
  const numeric = safeNum(value);
  if (Math.abs(numeric % 1) > 0.0001) return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return Math.round(numeric).toLocaleString();
}

function formatCellValue(column, row) {
  const value = row && Object.prototype.hasOwnProperty.call(row, column.key) ? row[column.key] : "";
  if (column.kind === "date") return formatDateLabel(value);
  if (column.kind === "number") return value === "" ? "" : formatNumber(value);
  if (/description/i.test(column.key) || /description/i.test(column.label)) return formatDescriptionForDisplay(value);
  return String(value == null ? "" : value);
}

function compareValues(left, right, column) {
  if (!column) return 0;
  if (column.kind === "number") return safeNum(left) - safeNum(right);
  if (column.kind === "date") return textCompare(left, right);
  return textCompare(left, right);
}

function sourceBadgeVariant(sourceMode) {
  if (sourceMode === "raw_csv") return "success";
  if (sourceMode === "warehouse_transfer_events") return "info";
  if (sourceMode === "live_transfer_sync") return "info";
  if (sourceMode === "preview_json") return "warning";
  if (sourceMode === "stale_window") return "warning";
  if (sourceMode === "missing") return "danger";
  return "secondary";
}

function sourceBadgeLabel(sourceMode) {
  if (sourceMode === "raw_csv") return "Raw CSV";
  if (sourceMode === "warehouse_transfer_events") return "Transfer Cache";
  if (sourceMode === "live_transfer_sync") return "Live Sync";
  if (sourceMode === "preview_json") return "Preview only";
  if (sourceMode === "stale_window") return "Outside window";
  if (sourceMode === "missing") return "Missing";
  return "Unknown";
}

function sectionSummaryNote(section, packet) {
  if (!section || typeof section !== "object") return "";
  if (section.sourceMode === "stale_window") {
    if (packet && packet.windowStart && packet.windowEnd) {
      return "No matching activity between " + formatDateLabel(packet.windowStart) + " and " + formatDateLabel(packet.windowEnd) + ".";
    }
    return "No matching activity in the selected window.";
  }
  if (Array.isArray(section.notes) && section.notes.length) return String(section.notes[0] || "");
  return "";
}

function safeSheetName(value) {
  const cleaned = String(value || "").replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 31) : "Sheet";
}

function sanitizeFilePart(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "packet";
}

function buildCsv(columns, rows) {
  const header = columns.map(function(column) { return csvCell(column.label); }).join(",");
  const body = (Array.isArray(rows) ? rows : []).map(function(row) {
    return columns.map(function(column) {
      return csvCell(formatCellValue(column, row));
    }).join(",");
  });
  return [header].concat(body).join("\n");
}

function buildWorkbookRows(columns, rows) {
  const matrix = [columns.map(function(column) { return column.label; })];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    if (row && row.rowKind === "separator") {
      matrix.push(columns.map(function() { return ""; }));
      return;
    }
    matrix.push(columns.map(function(column) {
      if (!row || !Object.prototype.hasOwnProperty.call(row, column.key)) return "";
      if (column.kind === "date") return formatDateLabel(row[column.key]);
      return row[column.key] == null ? "" : row[column.key];
    }));
  });
  return matrix;
}

function buildWorkbookSheet(columns, rows, XLSX) {
  const matrix = buildWorkbookRows(columns, rows);
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  worksheet["!cols"] = columns.map(function(column, columnIndex) {
    const longestValue = matrix.reduce(function(max, row) {
      const cellValue = row && Object.prototype.hasOwnProperty.call(row, columnIndex) ? row[columnIndex] : "";
      return Math.max(max, String(cellValue == null ? "" : cellValue).length);
    }, String(column.label || "").length);
    return { wch: Math.min(Math.max(longestValue + 2, 12), 42) };
  });
  return worksheet;
}

export default function ReportingView() {
  const [asOfDate, setAsOfDate] = useState(todayIsoLocal());
  const [windowDays, setWindowDays] = useState("7");
  const [customer, setCustomer] = useState("all");
  const [activeSection, setActiveSection] = useState("inventory");
  const [searchText, setSearchText] = useState("");
  const [sortState, setSortState] = useState({ field: "", dir: "asc" });
  const [selectedConsumptionGroup, setSelectedConsumptionGroup] = useState("");
  const deferredSearch = useDeferredValue(searchText);

  const reportingQuery = useQuery({
    queryKey: ["reporting", asOfDate, windowDays, customer],
    queryFn: function() {
      return fetchReportingPacket(asOfDate, Number(windowDays || 7), customer);
    },
    placeholderData: function(previousData) {
      return previousData;
    },
    staleTime: 5 * 60 * 1000,
  });

  const packet = reportingQuery.data && typeof reportingQuery.data === "object" ? reportingQuery.data : null;
  const sections = packet && packet.sections && typeof packet.sections === "object" ? packet.sections : {};
  const isRefreshing = reportingQuery.isFetching && !!packet;

  useEffect(function() {
    if (customer !== "all") return;
    const available = packet && Array.isArray(packet.availableCustomers) ? packet.availableCustomers : [];
    if (available.length === 1) setCustomer(available[0]);
  }, [packet, customer]);

  useEffect(function() {
    if (!sections.consumption || !Array.isArray(sections.consumption.groups)) return;
    const groups = sections.consumption.groups;
    if (!groups.length) {
      if (selectedConsumptionGroup) setSelectedConsumptionGroup("");
      return;
    }
    const exists = groups.some(function(group) { return group.key === selectedConsumptionGroup; });
    if (!exists) setSelectedConsumptionGroup(groups[0].key);
  }, [sections, selectedConsumptionGroup]);

  useEffect(function() {
    setSearchText("");
    setSortState({ field: "", dir: "asc" });
  }, [activeSection]);

  const sectionTabs = useMemo(function() {
    return SECTION_ORDER.map(function(sectionKey) {
      const section = sections[sectionKey] || {};
      const count = sectionKey === "consumption"
        ? (Array.isArray(section.groups) ? section.groups.length : 0)
        : Number(section.rowCount || 0);
      return {
        key: sectionKey,
        label: section.label || sectionKey,
        count: count,
      };
    });
  }, [sections]);

  const activeSectionData = sections[activeSection] || null;
  const activeColumns = activeSectionData && Array.isArray(activeSectionData.columns) ? activeSectionData.columns : [];

  const activeConsumptionGroup = useMemo(function() {
    if (activeSection !== "consumption" || !sections.consumption || !Array.isArray(sections.consumption.groups)) return null;
    return sections.consumption.groups.find(function(group) { return group.key === selectedConsumptionGroup; }) || sections.consumption.groups[0] || null;
  }, [activeSection, sections, selectedConsumptionGroup]);

  const activeRows = useMemo(function() {
    if (!activeSectionData) return [];
    if (activeSection === "consumption") {
      return activeConsumptionGroup && Array.isArray(activeConsumptionGroup.rows) ? activeConsumptionGroup.rows : [];
    }
    return Array.isArray(activeSectionData.rows) ? activeSectionData.rows : [];
  }, [activeSectionData, activeSection, activeConsumptionGroup]);

  const filteredRows = useMemo(function() {
    const rows = Array.isArray(activeRows) ? activeRows : [];
    const query = normalizeSearchValue(deferredSearch);
    let nextRows = rows;
    if (query) {
      nextRows = rows.filter(function(row) {
        if (!row || row.rowKind === "separator") return false;
        const haystack = activeColumns.map(function(column) {
          return formatCellValue(column, row);
        }).join(" ").toLowerCase();
        return haystack.includes(query);
      });
    }
    if (activeSection === "consumption") return nextRows;
    if (!sortState.field) return nextRows;
    const column = activeColumns.find(function(entry) { return entry.key === sortState.field; }) || null;
    return nextRows.slice().sort(function(left, right) {
      const dir = sortState.dir === "desc" ? -1 : 1;
      return compareValues(left && left[sortState.field], right && right[sortState.field], column) * dir;
    });
  }, [activeRows, activeColumns, deferredSearch, activeSection, sortState]);

  const packetFileBase = useMemo(function() {
    const selectedCustomer = customer !== "all"
      ? customer
      : (packet && Array.isArray(packet.availableCustomers) && packet.availableCustomers.length === 1 ? packet.availableCustomers[0] : "all_customers");
    return "packpulse_reporting_" + sanitizeFilePart(selectedCustomer) + "_" + sanitizeFilePart(asOfDate);
  }, [customer, packet, asOfDate]);

  const handleSort = function(columnKey) {
    setSortState(function(current) {
      if (current.field === columnKey) {
        return { field: columnKey, dir: current.dir === "asc" ? "desc" : "asc" };
      }
      return { field: columnKey, dir: "asc" };
    });
  };

  const downloadActiveCsv = function() {
    if (!activeColumns.length || !filteredRows.length) return;
    const filenameBase = activeSection === "consumption" && activeConsumptionGroup
      ? sanitizeFilePart(activeConsumptionGroup.sheetName)
      : sanitizeFilePart(activeSection);
    triggerDownload(
      buildCsv(activeColumns, filteredRows),
      packetFileBase + "_" + filenameBase + ".csv",
      "text/csv;charset=utf-8;",
    );
  };

  const downloadWorkbook = async function() {
    if (!packet || !packet.sections) return;
    const xlsxModule = await import("xlsx");
    const XLSX = xlsxModule.default || xlsxModule;
    const workbook = XLSX.utils.book_new();

    SECTION_ORDER.forEach(function(sectionKey) {
      const section = packet.sections[sectionKey];
      if (!section || !Array.isArray(section.columns) || !section.columns.length) return;
      if (sectionKey === "consumption") {
        (Array.isArray(section.groups) ? section.groups : []).forEach(function(group) {
          const worksheet = buildWorkbookSheet(section.columns, group.rows || [], XLSX);
          XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(group.sheetName));
        });
        return;
      }
      const worksheet = buildWorkbookSheet(section.columns, section.rows || [], XLSX);
      XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(section.label || sectionKey));
    });

    XLSX.writeFile(workbook, packetFileBase + "_eod.xlsx", { bookType: "xlsx" });
  };

  if (!packet && reportingQuery.isLoading) {
    return <Card className="px-4 py-4 text-sm text-[rgb(var(--muted))]">Loading reporting packet...</Card>;
  }

  if (reportingQuery.error) {
    return <Card className="px-4 py-4 text-sm text-[rgb(var(--danger))]">{String(reportingQuery.error.message || "Could not load reporting packet.")}</Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-[rgb(var(--foreground))]">Reporting</h2>
              <Badge variant="info">Customer Packet</Badge>
              {isRefreshing ? <Badge variant="secondary">Refreshing…</Badge> : null}
            </div>
            <p className="max-w-3xl text-sm text-[rgb(var(--muted))]">
              Recreate the customer-facing EOD packet inside PackPulse using stored Nulogy artifacts. Inventory is treated as an as-of snapshot, and activity tabs use a rolling window.
            </p>
            <div className="flex flex-wrap gap-2 text-xs text-[rgb(var(--muted))]">
              <span>Window: {packet && packet.windowStart ? formatDateLabel(packet.windowStart) : "--"} to {packet && packet.windowEnd ? formatDateLabel(packet.windowEnd) : "--"}</span>
              <span>Customer: {customer === "all" ? "All customers" : customer}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button onClick={downloadWorkbook} variant="outline" disabled={!packet}>Download Excel Packet</Button>
            <Button onClick={downloadActiveCsv} variant="outline" disabled={!filteredRows.length}>Download Active CSV</Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted))]">As of date</div>
            <DatePicker value={asOfDate} onChange={setAsOfDate} />
          </div>
          <label className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted))]">Rolling window</div>
            <select
              value={windowDays}
              onChange={function(event) { setWindowDays(event.target.value); }}
              className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]"
            >
              {WINDOW_OPTIONS.map(function(option) {
                return <option key={option} value={String(option)}>{option} day{option === 1 ? "" : "s"}</option>;
              })}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted))]">Customer</div>
            <select
              value={customer}
              onChange={function(event) { setCustomer(event.target.value); }}
              className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]"
            >
              <option value="all">All customers</option>
              {(packet && Array.isArray(packet.availableCustomers) ? packet.availableCustomers : []).map(function(option) {
                return <option key={option} value={option}>{option}</option>;
              })}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted))]">Search active tab</div>
            <Input value={searchText} onChange={function(event) { setSearchText(event.target.value); }} placeholder="Search visible rows" />
          </label>
        </div>
      </Card>

      {packet && Array.isArray(packet.notes) && packet.notes.length ? (
        <Card className="p-4">
          <div className="space-y-2">
            <div className="text-sm font-medium text-[rgb(var(--foreground))]">Implementation notes</div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-[rgb(var(--muted))]">
              {packet.notes.map(function(note) {
                return <li key={note}>{note}</li>;
              })}
            </ul>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-5">
        {SECTION_ORDER.map(function(sectionKey) {
          const section = sections[sectionKey] || {};
          return (
            <Card key={sectionKey} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[rgb(var(--foreground))]">{section.label || sectionKey}</div>
                  <div className="mt-1 text-xs text-[rgb(var(--muted))]">{section.reportCode || "--"}</div>
                </div>
                <Badge variant={sourceBadgeVariant(section.sourceMode)}>{sourceBadgeLabel(section.sourceMode)}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(Array.isArray(section.metrics) ? section.metrics : []).slice(0, 4).map(function(metric) {
                  return (
                    <div key={metric.label} className="rounded-md border border-[rgb(var(--border))] px-2.5 py-2">
                      <div className="text-[11px] uppercase tracking-wide text-[rgb(var(--muted))]">{metric.label}</div>
                      <div className="text-sm font-medium text-[rgb(var(--foreground))]">{metric.value}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 text-xs text-[rgb(var(--muted))]">
                {section.generatedAtLabel ? ("Generated " + section.generatedAtLabel) : "No artifact run available"}
              </div>
              {sectionSummaryNote(section, packet) ? (
                <div className="mt-2 text-xs text-[rgb(var(--muted))]">{sectionSummaryNote(section, packet)}</div>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <TabsNav items={sectionTabs} activeKey={activeSection} onChange={setActiveSection} className="mb-0" />

        {activeSectionData ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-[rgb(var(--foreground))]">{activeSectionData.label}</h3>
                  <Badge variant={sourceBadgeVariant(activeSectionData.sourceMode)}>{sourceBadgeLabel(activeSectionData.sourceMode)}</Badge>
                  {activeSectionData.possibleTruncation ? <Badge variant="warning">Possible truncation</Badge> : null}
                  {activeSectionData.generatedAtLabel ? <Badge variant="secondary">{activeSectionData.generatedAtLabel}</Badge> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(Array.isArray(activeSectionData.metrics) ? activeSectionData.metrics : []).map(function(metric) {
                    return <Badge key={metric.label} variant="secondary">{metric.label}: {metric.value}</Badge>;
                  })}
                </div>
              </div>
              <div className="text-sm text-[rgb(var(--muted))]">
                {activeSection === "consumption" && activeConsumptionGroup
                  ? (activeConsumptionGroup.sheetName + " · " + Number(activeConsumptionGroup.rowCount || 0).toLocaleString() + " raw rows")
                  : (Number(activeSectionData.rowCount || 0).toLocaleString() + " rows")}
              </div>
            </div>

            {activeSection === "consumption" && Array.isArray(activeSectionData.groups) && activeSectionData.groups.length ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted))]">Consumption packet tabs</div>
                <div className="flex flex-wrap gap-2">
                  {activeSectionData.groups.map(function(group) {
                    const isActive = group.key === (activeConsumptionGroup && activeConsumptionGroup.key);
                    return (
                      <Button
                        key={group.key}
                        type="button"
                        size="sm"
                        variant={isActive ? "default" : "outline"}
                        onClick={function() { setSelectedConsumptionGroup(group.key); }}
                      >
                        {group.sheetName}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {Array.isArray(activeSectionData.notes) && activeSectionData.notes.length ? (
              <Card className="border-dashed p-3">
                <ul className="list-disc space-y-1 pl-5 text-sm text-[rgb(var(--muted))]">
                  {activeSectionData.notes.map(function(note) {
                    return <li key={note}>{note}</li>;
                  })}
                </ul>
              </Card>
            ) : null}

            {!activeColumns.length ? (
              <Card className="px-4 py-4 text-sm text-[rgb(var(--muted))]">No columns available for this section yet.</Card>
            ) : activeSectionData.sourceMode === "stale_window" ? (
              <Card className="px-4 py-4 text-sm text-[rgb(var(--muted))]">
                {sectionSummaryNote(activeSectionData, packet) || "No matching activity in the selected window."}
              </Card>
            ) : !filteredRows.length ? (
              <Card className="px-4 py-4 text-sm text-[rgb(var(--muted))]">No rows match the current filters.</Card>
            ) : (
              <TableShell>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[rgb(var(--surface-2))] text-left">
                      <tr>
                        {activeColumns.map(function(column) {
                          const isSortable = activeSection !== "consumption";
                          const isActiveSort = sortState.field === column.key;
                          return (
                            <th key={column.key} className="whitespace-nowrap border-b border-[rgb(var(--border))] px-3 py-2 font-medium text-[rgb(var(--foreground))]">
                              {isSortable ? (
                                <SortHeaderButton onClick={function() { handleSort(column.key); }}>
                                  {column.label}{isActiveSort ? (sortState.dir === "asc" ? " ↑" : " ↓") : ""}
                                </SortHeaderButton>
                              ) : column.label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map(function(row, index) {
                        if (row && row.rowKind === "separator") {
                          return (
                            <tr key={"separator-" + index}>
                              <td colSpan={activeColumns.length} className="h-3 border-b border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--border))_10%,white)]" />
                            </tr>
                          );
                        }
                        const rowClassName = row && row.rowKind === "finished_good"
                          ? "bg-[color-mix(in_oklab,rgb(var(--border))_18%,white)] font-medium"
                          : "bg-[rgb(var(--surface))]";
                        return (
                          <tr key={String(row && row.id ? row.id : index)} className={rowClassName}>
                            {activeColumns.map(function(column) {
                              const displayValue = formatCellValue(column, row);
                              const alignment = column.kind === "number" ? "text-right" : "text-left";
                              return (
                                <td key={column.key} className={"border-b border-[rgb(var(--border))] px-3 py-2 align-top text-[rgb(var(--foreground))] " + alignment}>
                                  {displayValue || ""}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </TableShell>
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
