import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Factory,
  FileText,
  Package2,
  ReceiptText,
  Route,
  Send,
  Truck
} from "lucide-react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";

var CONTACT_DEPARTMENTS = ["Supply Chain", "Logistics", "Procurement", "Production", "Billing", "Misc"];
var YES_NO_OPTIONS = [
  { value: "", label: "Select" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" }
];
var DIELINE_STATUS_OPTIONS = [
  { value: "", label: "Select" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "revisions_required", label: "Revisions Required" }
];
var REPORTING_FREQUENCY_OPTIONS = [
  { value: "", label: "Select" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "ad_hoc", label: "Ad hoc" }
];
var CALL_CADENCE_OPTIONS = [
  { value: "", label: "Select" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "as_needed", label: "As needed" }
];
var SERVICE_TYPE_OPTIONS = [
  { value: "variety_packing", label: "Variety Packing" },
  { value: "repacking", label: "Repacking" },
  { value: "warehousing", label: "Warehousing" },
  { value: "other", label: "Other" }
];
var REPORTING_METHOD_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "portal_shared_drive", label: "Portal / Shared Drive" },
  { value: "operations_call", label: "Operations Call" }
];
var QUERY_KEY = ["customer-onboarding-intakes"];
var SELECT_CLASS_NAME = "flex h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 py-1 text-sm text-[rgb(var(--foreground))] shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))] focus:ring-offset-1";
var SECTION_LINKS = [
  { id: "onboarding-customer", label: "Customer", icon: Building2 },
  { id: "onboarding-scope", label: "Scope", icon: Package2 },
  { id: "onboarding-quality", label: "Quality", icon: ClipboardCheck },
  { id: "onboarding-launch", label: "Launch", icon: CalendarClock },
  { id: "onboarding-items", label: "Items", icon: Boxes },
  { id: "onboarding-logistics", label: "Logistics", icon: Truck },
  { id: "onboarding-billing", label: "Billing", icon: ReceiptText },
  { id: "onboarding-reporting", label: "Reporting", icon: FileText },
  { id: "onboarding-acknowledgment", label: "Acknowledgment", icon: Send }
];

function createBlankContact(department) {
  return {
    department: department,
    fullName: "",
    title: "",
    email: "",
    phone: ""
  };
}

function createBlankSkuRow() {
  return {
    fgSkuName: "",
    packSize: "",
    flavorCount: "",
    canSize: "",
    canType: "",
    wipFormat: ""
  };
}

function createBlankWipItem() {
  return {
    itemNumber: "",
    itemDescription: "",
    caseCount: "",
    casesPerPallet: ""
  };
}

function createBlankPackagingItem() {
  return {
    itemNumber: "",
    itemDescription: "",
    quantityPerPallet: ""
  };
}

function createBlankFinishedGood() {
  return {
    itemNumber: "",
    itemDescription: "",
    casesPerPallet: ""
  };
}

function createBlankForm() {
  return {
    companyLegalName: "",
    dba: "",
    website: "",
    billingAddress: "",
    contacts: CONTACT_DEPARTMENTS.map(function(department) {
      return createBlankContact(department);
    }),
    skuRows: [createBlankSkuRow()],
    packaging: {
      bundlingFilmRequired: "no",
      bundlingFilmNotes: "",
      cornerBoardsRequired: "",
      cornerBoardsNotes: "",
      slipSheetsRequired: "",
      slipSheetsNotes: "",
      labelsRequired: "no",
      labelCount: "",
      labelNotes: "",
      labelSizePlacement: "",
      labelFormat1: "",
      labelFormat2: "",
      trayPackRequired: "no",
      trayPackNotes: "",
      reuseTray: "no",
      reuseTrayNotes: "",
      shelfLife: "12 Months",
      shelfLifeNotes: "",
      lotCodeRequired: "no",
      lotCodeFormat: "",
      bestByRequired: "no",
      bestByFormat: "",
      dielineReference: "",
      dielineApprovalStatus: "",
      palletPattern: "",
      palletRequirements: "",
      serviceTypes: [],
      otherServiceType: ""
    },
    quality: {
      qaSamplingFrequency: "Every 60 Mins",
      qaSamplingNotes: "",
      holdReleaseProcedure: "",
      quarantineRequirements: "",
      fifoFefoRequirements: "",
      recallContact: "",
      specialHandlingNotes: ""
    },
    launch: {
      targetProductionDate: "",
      inMarketDeadline: "",
      initialRunVolumeCases: "",
      initialPoNumber: "",
      initialPoProvided: "",
      projectedMonthlyVolumeCases: "",
      projectedAnnualVolumeCases: "",
      leadTimeConstraints: ""
    },
    wipItems: [createBlankWipItem()],
    packagingItems: [createBlankPackagingItem()],
    finishedGoods: [createBlankFinishedGood()],
    logistics: {
      inboundWarehouse: "",
      outboundWarehouse: "",
      preferredCarriers: "",
      bolRequirements: ""
    },
    billing: {
      contactName: "",
      title: "",
      email: "",
      phone: "",
      apPortalMethod: "",
      einTaxId: "",
      prePaymentRequired: "",
      creditReference: ""
    },
    reporting: {
      reportingFrequency: "",
      monthEndRequired: "",
      reportingMethods: ["email"],
      operationsCallCadence: "biweekly",
      distributionLists: ""
    },
    additionalNotes: "",
    partnershipNotes: "",
    acknowledgment: {
      fullName: "",
      title: "",
      signature: "",
      date: new Date().toISOString().slice(0, 10)
    }
  };
}

function mergeContacts(rawContacts) {
  var list = Array.isArray(rawContacts) ? rawContacts : [];
  return CONTACT_DEPARTMENTS.map(function(department) {
    var match = list.find(function(row) {
      return String(row && row.department || "").trim().toLowerCase() === department.toLowerCase();
    }) || {};
    return {
      department: department,
      fullName: String(match.fullName || ""),
      title: String(match.title || ""),
      email: String(match.email || ""),
      phone: String(match.phone || "")
    };
  });
}

function normalizeRows(list, createRow) {
  var rows = Array.isArray(list) ? list : [];
  if (!rows.length) return [createRow()];
  return rows.map(function(row) {
    return Object.assign(createRow(), row || {});
  });
}

function mergeFormWithBlank(raw) {
  var blank = createBlankForm();
  var data = raw && typeof raw === "object" ? raw : {};
  return {
    companyLegalName: String(data.companyLegalName || blank.companyLegalName),
    dba: String(data.dba || blank.dba),
    website: String(data.website || blank.website),
    billingAddress: String(data.billingAddress || blank.billingAddress),
    contacts: mergeContacts(data.contacts),
    skuRows: normalizeRows(data.skuRows, createBlankSkuRow),
    packaging: Object.assign({}, blank.packaging, data.packaging || {}, {
      serviceTypes: Array.isArray(data.packaging && data.packaging.serviceTypes) ? data.packaging.serviceTypes.slice() : blank.packaging.serviceTypes.slice()
    }),
    quality: Object.assign({}, blank.quality, data.quality || {}),
    launch: Object.assign({}, blank.launch, data.launch || {}),
    wipItems: normalizeRows(data.wipItems, createBlankWipItem),
    packagingItems: normalizeRows(data.packagingItems, createBlankPackagingItem),
    finishedGoods: normalizeRows(data.finishedGoods, createBlankFinishedGood),
    logistics: Object.assign({}, blank.logistics, data.logistics || {}),
    billing: Object.assign({}, blank.billing, data.billing || {}),
    reporting: Object.assign({}, blank.reporting, data.reporting || {}, {
      reportingMethods: Array.isArray(data.reporting && data.reporting.reportingMethods) ? data.reporting.reportingMethods.slice() : blank.reporting.reportingMethods.slice()
    }),
    additionalNotes: String(data.additionalNotes || blank.additionalNotes),
    partnershipNotes: String(data.partnershipNotes || blank.partnershipNotes),
    acknowledgment: Object.assign({}, blank.acknowledgment, data.acknowledgment || {})
  };
}

function arrayRowHasContent(row, keys) {
  return keys.some(function(key) {
    return String(row && row[key] || "").trim();
  });
}

function formatDateTime(value) {
  if (!value) return "";
  var dt = new Date(value);
  if (isNaN(dt)) return "";
  return dt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDateLabel(value) {
  if (!value) return "Not set";
  var dt = new Date(String(value) + "T00:00:00");
  if (isNaN(dt)) return String(value);
  return dt.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function recordTitle(row) {
  return String(row && row.customer_name || "").trim() || "Untitled intake";
}

function statusVariant(status) {
  return status === "submitted" ? "success" : "warning";
}

function Field({ label, hint, required, className, children }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
        {label}
        {required ? <span className="ml-1 text-[rgb(var(--danger))]">*</span> : null}
      </span>
      {children}
      {hint ? <span className="text-xs text-[rgb(var(--muted))]">{hint}</span> : null}
    </label>
  );
}

function TextField(props) {
  var label = props.label;
  var hint = props.hint;
  var required = props.required;
  var className = props.className;
  var inputProps = Object.assign({}, props);
  delete inputProps.label;
  delete inputProps.hint;
  delete inputProps.required;
  delete inputProps.className;
  return (
    <Field label={label} hint={hint} required={required} className={className}>
      <Input {...inputProps} />
    </Field>
  );
}

function TextAreaField(props) {
  var label = props.label;
  var hint = props.hint;
  var required = props.required;
  var className = props.className;
  var inputProps = Object.assign({}, props);
  delete inputProps.label;
  delete inputProps.hint;
  delete inputProps.required;
  delete inputProps.className;
  return (
    <Field label={label} hint={hint} required={required} className={className}>
      <Textarea {...inputProps} />
    </Field>
  );
}

function SelectField(props) {
  var label = props.label;
  var hint = props.hint;
  var required = props.required;
  var className = props.className;
  var value = props.value;
  var onChange = props.onChange;
  var options = props.options || [];
  return (
    <Field label={label} hint={hint} required={required} className={className}>
      <select className={SELECT_CLASS_NAME} value={value} onChange={onChange}>
        {options.map(function(option) {
          return (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          );
        })}
      </select>
    </Field>
  );
}

function ChoicePills({ options, values, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(function(option) {
        var selected = values.indexOf(option.value) !== -1;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={selected ? "active" : "outline"}
            onClick={function() { onToggle(option.value); }}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function SectionCard({ id, icon: Icon, title, description, children }) {
  return (
    <Card id={id} className="scroll-mt-28 overflow-hidden">
      <CardHeader className="border-b border-[rgb(var(--border))] bg-[linear-gradient(135deg,rgba(59,130,246,0.08),rgba(255,255,255,0.9))]">
        <div className="flex flex-wrap items-start gap-3">
          <div className="rounded-xl border border-white/60 bg-white/80 p-2 text-[rgb(var(--accent))] shadow-sm">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">{title}</div>
            <div className="mt-0.5 text-sm text-[rgb(var(--muted))]">{description}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">{children}</CardContent>
    </Card>
  );
}

function SummaryStat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-white/70 bg-white/85 px-3 py-3 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">{label}</div>
      <div className="mt-1 text-xl font-semibold text-[rgb(var(--foreground))]">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[rgb(var(--muted))]">{hint}</div> : null}
    </div>
  );
}

async function fetchIntakes() {
  var res = await fetch("/api/onboarding/intakes", { credentials: "include" });
  var body = await res.json();
  if (!res.ok) throw new Error(body && body.error ? body.error : "Could not load onboarding intakes");
  return {
    rows: Array.isArray(body && body.rows) ? body.rows : [],
    status: String(body && body.status || ""),
    message: String(body && body.message || "")
  };
}

export default function OnboardingView() {
  var queryClient = useQueryClient();
  var onboardingQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchIntakes,
    staleTime: 2 * 60 * 1000
  });
  var queryPayload = onboardingQuery.data || { rows: [], status: "", message: "" };
  var rows = queryPayload.rows || [];
  var apiStatus = queryPayload.status;
  var apiMessage = queryPayload.message;
  var loadError = onboardingQuery.isError
    ? (onboardingQuery.error && onboardingQuery.error.message ? onboardingQuery.error.message : "Could not load onboarding intakes")
    : "";

  var [recordMeta, setRecordMeta] = useState({
    id: "",
    status: "draft",
    createdAt: "",
    updatedAt: "",
    submittedAt: ""
  });
  var [formData, setFormData] = useState(createBlankForm());
  var [searchQuery, setSearchQuery] = useState("");
  var [dirty, setDirty] = useState(false);
  var [saving, setSaving] = useState(false);
  var [error, setError] = useState("");
  var [statusMessage, setStatusMessage] = useState("");
  var deferredSearchQuery = useDeferredValue(searchQuery);

  var hydrateRecord = useCallback(function(row) {
    setRecordMeta({
      id: String(row && row.id || ""),
      status: String(row && row.status || "draft"),
      createdAt: String(row && row.created_at || ""),
      updatedAt: String(row && row.updated_at || ""),
      submittedAt: String(row && row.submitted_at || "")
    });
    setFormData(mergeFormWithBlank(row && row.intake_data));
    setDirty(false);
    setError("");
    setStatusMessage("");
  }, []);

  var startNewIntake = useCallback(function() {
    if (dirty && typeof window !== "undefined" && !window.confirm("Discard unsaved changes and start a new intake?")) return;
    setRecordMeta({
      id: "",
      status: "draft",
      createdAt: "",
      updatedAt: "",
      submittedAt: ""
    });
    setFormData(createBlankForm());
    setDirty(false);
    setError("");
    setStatusMessage("");
  }, [dirty]);

  useEffect(function() {
    if (recordMeta.id || dirty) return;
    if (rows.length) {
      hydrateRecord(rows[0]);
    }
  }, [rows, recordMeta.id, dirty, hydrateRecord]);

  var applyFormUpdate = function(updater) {
    setFormData(function(prev) {
      return typeof updater === "function" ? updater(prev) : prev;
    });
    setDirty(true);
    setError("");
    setStatusMessage("");
  };

  var handleRootFieldChange = function(key, value) {
    applyFormUpdate(function(prev) {
      return Object.assign({}, prev, { [key]: value });
    });
  };

  var handleSectionFieldChange = function(sectionKey, key, value) {
    applyFormUpdate(function(prev) {
      return Object.assign({}, prev, {
        [sectionKey]: Object.assign({}, prev[sectionKey], { [key]: value })
      });
    });
  };

  var handleArrayRowChange = function(arrayKey, index, key, value) {
    applyFormUpdate(function(prev) {
      return Object.assign({}, prev, {
        [arrayKey]: (prev[arrayKey] || []).map(function(row, rowIndex) {
          if (rowIndex !== index) return row;
          return Object.assign({}, row, { [key]: value });
        })
      });
    });
  };

  var addArrayRow = function(arrayKey, createRow) {
    applyFormUpdate(function(prev) {
      return Object.assign({}, prev, {
        [arrayKey]: (prev[arrayKey] || []).concat([createRow()])
      });
    });
  };

  var removeArrayRow = function(arrayKey, index, createRow) {
    applyFormUpdate(function(prev) {
      var nextRows = (prev[arrayKey] || []).filter(function(_row, rowIndex) {
        return rowIndex !== index;
      });
      return Object.assign({}, prev, {
        [arrayKey]: nextRows.length ? nextRows : [createRow()]
      });
    });
  };

  var toggleNestedChoice = function(sectionKey, key, value) {
    applyFormUpdate(function(prev) {
      var list = Array.isArray(prev[sectionKey] && prev[sectionKey][key]) ? prev[sectionKey][key].slice() : [];
      var nextList = list.indexOf(value) === -1 ? list.concat([value]) : list.filter(function(entry) { return entry !== value; });
      return Object.assign({}, prev, {
        [sectionKey]: Object.assign({}, prev[sectionKey], { [key]: nextList })
      });
    });
  };

  var filteredRows = useMemo(function() {
    var needle = String(deferredSearchQuery || "").trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(function(row) {
      var haystack = [
        row.customer_name,
        row.primary_contact_name,
        row.primary_contact_email,
        row.status,
        row.target_production_date
      ].join(" ").toLowerCase();
      return haystack.indexOf(needle) !== -1;
    });
  }, [rows, deferredSearchQuery]);

  var completionChecks = useMemo(function() {
    return [
      { label: "Customer profile", done: !!(String(formData.companyLegalName || "").trim() && String(formData.billingAddress || "").trim()) },
      { label: "Point of contact", done: formData.contacts.some(function(row) { return String(row && (row.fullName || row.email) || "").trim(); }) },
      { label: "SKU scope", done: formData.skuRows.some(function(row) { return arrayRowHasContent(row, ["fgSkuName", "packSize", "canSize"]); }) },
      { label: "Packaging standards", done: !!(String(formData.packaging.palletPattern || "").trim() || (formData.packaging.serviceTypes || []).length) },
      { label: "Quality requirements", done: !!(String(formData.quality.qaSamplingFrequency || "").trim() || String(formData.quality.recallContact || "").trim()) },
      { label: "Launch plan", done: !!(String(formData.launch.targetProductionDate || "").trim() && String(formData.launch.initialRunVolumeCases || "").trim()) },
      { label: "WIP items", done: formData.wipItems.some(function(row) { return arrayRowHasContent(row, ["itemNumber", "itemDescription"]); }) },
      { label: "Packaging items", done: formData.packagingItems.some(function(row) { return arrayRowHasContent(row, ["itemNumber", "itemDescription"]); }) },
      { label: "Finished goods", done: formData.finishedGoods.some(function(row) { return arrayRowHasContent(row, ["itemNumber", "itemDescription"]); }) },
      { label: "Logistics", done: !!(String(formData.logistics.inboundWarehouse || "").trim() || String(formData.logistics.outboundWarehouse || "").trim()) },
      { label: "Billing + reporting", done: !!(String(formData.billing.email || "").trim() && String(formData.reporting.reportingFrequency || "").trim()) },
      { label: "Acknowledgment", done: !!(String(formData.acknowledgment.fullName || "").trim() && String(formData.acknowledgment.signature || "").trim() && String(formData.acknowledgment.date || "").trim()) }
    ];
  }, [formData]);

  var completedCount = completionChecks.filter(function(check) { return check.done; }).length;
  var completionPct = Math.round((completedCount / completionChecks.length) * 100);
  var skuCount = formData.skuRows.filter(function(row) {
    return arrayRowHasContent(row, ["fgSkuName", "packSize", "canSize"]);
  }).length;
  var validationIssues = useMemo(function() {
    var issues = [];
    if (!String(formData.companyLegalName || "").trim()) issues.push("Add the company legal name.");
    if (!formData.contacts.some(function(row) { return String(row && (row.fullName || row.email) || "").trim(); })) issues.push("Capture at least one customer contact.");
    if (!formData.skuRows.some(function(row) { return String(row && row.fgSkuName || "").trim(); })) issues.push("Add at least one finished good SKU.");
    if (!String(formData.launch.targetProductionDate || "").trim()) issues.push("Set the target production date.");
    if (!String(formData.acknowledgment.fullName || "").trim()) issues.push("Add the customer acknowledgment name.");
    if (!String(formData.acknowledgment.signature || "").trim()) issues.push("Capture the typed signature.");
    return issues;
  }, [formData]);

  var persistIntake = useCallback(async function(nextStatus) {
    if (nextStatus === "submitted" && validationIssues.length) {
      setError(validationIssues[0]);
      return;
    }
    setSaving(true);
    setError("");
    setStatusMessage("");
    try {
      var res = await fetch("/api/onboarding/intakes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_intake",
          intake: {
            id: recordMeta.id || "",
            status: nextStatus,
            intake_data: formData
          }
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body && body.error ? body.error : "Could not save onboarding intake");
      if (body && body.status === "missing_customer_onboarding_table") {
        setError(body.message || "Customer onboarding table is not set up yet.");
        return;
      }
      if (!body || !body.row) throw new Error("The onboarding API did not return a saved record.");
      hydrateRecord(body.row);
      setStatusMessage(nextStatus === "submitted" ? "Onboarding intake submitted." : "Draft saved.");
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (saveError) {
      setError(saveError && saveError.message ? saveError.message : "Could not save onboarding intake");
    } finally {
      setSaving(false);
    }
  }, [formData, hydrateRecord, queryClient, recordMeta.id, validationIssues]);

  var handleRecordSelect = function(row) {
    if (dirty && typeof window !== "undefined" && !window.confirm("Discard unsaved changes and open another intake?")) return;
    hydrateRecord(row);
  };

  var currentTitle = String(formData.companyLegalName || "").trim() || recordTitle(recordMeta);
  var primaryContact = formData.contacts.find(function(row) {
    return String(row && (row.fullName || row.email) || "").trim();
  }) || null;
  var targetDateLabel = formatDateLabel(formData.launch.targetProductionDate || "");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[320px,minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-[rgb(var(--border))] bg-[linear-gradient(145deg,rgba(59,130,246,0.1),rgba(255,255,255,0.92))]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-[rgb(var(--foreground))]">Onboarding Workspace</div>
                  <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                    Convert REV’s intake PDF into a structured PackPulse workflow.
                  </div>
                </div>
                <Badge variant={recordMeta.status === "submitted" ? "success" : "warning"}>
                  {recordMeta.status === "submitted" ? "Submitted" : "Draft"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              <Button type="button" variant="default" className="w-full" onClick={startNewIntake}>
                New Intake
              </Button>
              <Field label="Search saved intakes">
                <Input
                  value={searchQuery}
                  onChange={function(event) { setSearchQuery(event.target.value); }}
                  placeholder="Search customer, contact, or date"
                />
              </Field>
              <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-2">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">Saved Intakes</span>
                  <span className="text-xs text-[rgb(var(--muted))]">{filteredRows.length}</span>
                </div>
                <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                  {filteredRows.map(function(row) {
                    var selected = recordMeta.id && row.id === recordMeta.id;
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={function() { handleRecordSelect(row); }}
                        className={cn(
                          "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                          selected
                            ? "border-[rgb(var(--accent))] bg-[color-mix(in_oklab,rgb(var(--accent))_10%,white)]"
                            : "border-[rgb(var(--border))] bg-white hover:border-[rgb(var(--accent))]/40 hover:bg-[rgb(var(--surface))]"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-[rgb(var(--foreground))]">{recordTitle(row)}</div>
                            <div className="mt-0.5 truncate text-xs text-[rgb(var(--muted))]">
                              {row.primary_contact_name || row.primary_contact_email || "No contact yet"}
                            </div>
                          </div>
                          <Badge variant={statusVariant(row.status)}>{row.status === "submitted" ? "Submitted" : "Draft"}</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted))]">
                          <span>{row.target_production_date ? formatDateLabel(row.target_production_date) : "No launch date"}</span>
                          <span>•</span>
                          <span>{row.updated_at ? "Updated " + formatDateTime(row.updated_at) : "Not saved yet"}</span>
                        </div>
                      </button>
                    );
                  })}
                  {!filteredRows.length && !onboardingQuery.isPending ? (
                    <div className="rounded-xl border border-dashed border-[rgb(var(--border))] bg-white px-3 py-4 text-sm text-[rgb(var(--muted))]">
                      No onboarding intakes match this search yet.
                    </div>
                  ) : null}
                  {onboardingQuery.isPending ? (
                    <div className="rounded-xl border border-dashed border-[rgb(var(--border))] bg-white px-3 py-4 text-sm text-[rgb(var(--muted))]">
                      Loading onboarding intakes…
                    </div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden border-transparent bg-[linear-gradient(140deg,rgba(59,130,246,0.13),rgba(255,255,255,0.96)_38%,rgba(14,165,233,0.08))] shadow-sm">
            <CardContent className="space-y-4 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">Customer Onboarding</Badge>
                    {dirty ? <Badge variant="warning">Unsaved Changes</Badge> : null}
                    {statusMessage ? <Badge variant="success">{statusMessage}</Badge> : null}
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[rgb(var(--foreground))]">
                    {currentTitle}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[rgb(var(--muted))]">
                    This PackPulse experience mirrors REV Copack’s June 3, 2026 onboarding form and turns it into a structured, reusable workspace for customer launch planning.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={function() { persistIntake("draft"); }} disabled={saving}>
                    {saving ? "Saving..." : "Save Draft"}
                  </Button>
                  <Button type="button" variant="default" onClick={function() { persistIntake("submitted"); }} disabled={saving}>
                    {saving ? "Submitting..." : "Submit Intake"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <SummaryStat label="Completion" value={completionPct + "%"} hint={completedCount + " of " + completionChecks.length + " checkpoints"} />
                <SummaryStat label="SKU Count" value={String(skuCount || 0)} hint="Finished goods captured" />
                <SummaryStat label="Target Launch" value={targetDateLabel} hint={formData.launch.inMarketDeadline ? "Retail deadline " + formatDateLabel(formData.launch.inMarketDeadline) : "Set production and retail timing"} />
                <SummaryStat label="Primary Contact" value={primaryContact ? (primaryContact.fullName || primaryContact.email || "Named") : "Unassigned"} hint={recordMeta.updatedAt ? "Last saved " + formatDateTime(recordMeta.updatedAt) : "Not saved yet"} />
              </div>

              {apiStatus === "missing_customer_onboarding_table" ? (
                <div className="rounded-xl border border-[color:rgb(var(--warning))] bg-[color-mix(in_oklab,rgb(var(--warning))_12%,white)] px-4 py-3 text-sm text-[rgb(var(--warning))]">
                  {apiMessage || "Customer onboarding saves are not available until the Supabase table is created."}
                </div>
              ) : null}
              {loadError ? (
                <div className="rounded-xl border border-[color:rgb(var(--danger))] bg-[color-mix(in_oklab,rgb(var(--danger))_12%,white)] px-4 py-3 text-sm text-[rgb(var(--danger))]">
                  {loadError}
                </div>
              ) : null}
              {error ? (
                <div className="rounded-xl border border-[color:rgb(var(--danger))] bg-[color-mix(in_oklab,rgb(var(--danger))_12%,white)] px-4 py-3 text-sm text-[rgb(var(--danger))]">
                  {error}
                </div>
              ) : null}
              {validationIssues.length ? (
                <div className="rounded-xl border border-[rgb(var(--border))] bg-white/85 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">Before Submission</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {validationIssues.map(function(issue) {
                      return <Badge key={issue} variant="warning">{issue}</Badge>;
                    })}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="sticky top-2 z-10 rounded-xl border border-[rgb(var(--border))] bg-[rgba(255,255,255,0.92)] p-2 backdrop-blur">
            <div className="flex flex-wrap gap-2">
              {SECTION_LINKS.map(function(section) {
                var Icon = section.icon;
                return (
                  <Button
                    key={section.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={function() {
                      var el = typeof document !== "undefined" ? document.getElementById(section.id) : null;
                      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {section.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <SectionCard
            id="onboarding-customer"
            icon={Building2}
            title="1. Customer Contact Information"
            description="Capture the legal entity, billing footprint, and the cross-functional contacts REV will rely on during launch."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Company Legal Name" required value={formData.companyLegalName} onChange={function(event) { handleRootFieldChange("companyLegalName", event.target.value); }} />
              <TextField label="DBA" value={formData.dba} onChange={function(event) { handleRootFieldChange("dba", event.target.value); }} />
              <TextField label="Website" placeholder="https://example.com" value={formData.website} onChange={function(event) { handleRootFieldChange("website", event.target.value); }} />
              <TextAreaField label="Billing Address" required value={formData.billingAddress} onChange={function(event) { handleRootFieldChange("billingAddress", event.target.value); }} className="md:col-span-2" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Key Points of Contact</div>
                  <div className="text-sm text-[rgb(var(--muted))]">Mirror the departments on the original REV onboarding form so handoffs stay familiar.</div>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {formData.contacts.map(function(contact, index) {
                  return (
                    <div key={contact.department} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3">
                      <div className="mb-3 text-sm font-semibold text-[rgb(var(--foreground))]">{contact.department}</div>
                      <div className="grid gap-3">
                        <TextField label="Full Name" value={contact.fullName} onChange={function(event) { handleArrayRowChange("contacts", index, "fullName", event.target.value); }} />
                        <TextField label="Title / Role" value={contact.title} onChange={function(event) { handleArrayRowChange("contacts", index, "title", event.target.value); }} />
                        <TextField label="Email Address" type="email" value={contact.email} onChange={function(event) { handleArrayRowChange("contacts", index, "email", event.target.value); }} />
                        <TextField label="Phone Number" value={contact.phone} onChange={function(event) { handleArrayRowChange("contacts", index, "phone", event.target.value); }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="onboarding-scope"
            icon={Package2}
            title="2. Project Scope"
            description="Define the finished-good lineup, the WIP presentation, and the packaging/pallet rules REV needs before production scheduling."
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[rgb(var(--foreground))]">2a. SKU Overview</div>
                  <div className="text-sm text-[rgb(var(--muted))]">Create one card per finished good / flavor family.</div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={function() { addArrayRow("skuRows", createBlankSkuRow); }}>
                  Add SKU
                </Button>
              </div>
              <div className="space-y-3">
                {formData.skuRows.map(function(row, index) {
                  return (
                    <div key={"sku-" + index} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Finished Good #{index + 1}</div>
                        <Button type="button" variant="ghost" size="sm" onClick={function() { removeArrayRow("skuRows", index, createBlankSkuRow); }}>
                          Remove
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <TextField label="FG SKU Name" value={row.fgSkuName} onChange={function(event) { handleArrayRowChange("skuRows", index, "fgSkuName", event.target.value); }} />
                        <TextField label="Pack Size" value={row.packSize} onChange={function(event) { handleArrayRowChange("skuRows", index, "packSize", event.target.value); }} />
                        <TextField label="# of Flavors" value={row.flavorCount} onChange={function(event) { handleArrayRowChange("skuRows", index, "flavorCount", event.target.value); }} />
                        <TextField label="Can Size" value={row.canSize} onChange={function(event) { handleArrayRowChange("skuRows", index, "canSize", event.target.value); }} />
                        <TextField label="Can Type" hint="Example: Slim" value={row.canType} onChange={function(event) { handleArrayRowChange("skuRows", index, "canType", event.target.value); }} />
                        <TextField label="How is WIP formatted?" hint="12pk / 24pk / bundled" value={row.wipFormat} onChange={function(event) { handleArrayRowChange("skuRows", index, "wipFormat", event.target.value); }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Bundling Film Required" value={formData.packaging.bundlingFilmRequired} onChange={function(event) { handleSectionFieldChange("packaging", "bundlingFilmRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Bundling Film Notes" value={formData.packaging.bundlingFilmNotes} onChange={function(event) { handleSectionFieldChange("packaging", "bundlingFilmNotes", event.target.value); }} />
              <SelectField label="Corner Boards Required" value={formData.packaging.cornerBoardsRequired} onChange={function(event) { handleSectionFieldChange("packaging", "cornerBoardsRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Corner Boards Notes" value={formData.packaging.cornerBoardsNotes} onChange={function(event) { handleSectionFieldChange("packaging", "cornerBoardsNotes", event.target.value); }} />
              <SelectField label="Slip Sheets Required" value={formData.packaging.slipSheetsRequired} onChange={function(event) { handleSectionFieldChange("packaging", "slipSheetsRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Slip Sheets Notes" value={formData.packaging.slipSheetsNotes} onChange={function(event) { handleSectionFieldChange("packaging", "slipSheetsNotes", event.target.value); }} />
              <SelectField label="Labels Required" value={formData.packaging.labelsRequired} onChange={function(event) { handleSectionFieldChange("packaging", "labelsRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="How Many Labels?" value={formData.packaging.labelCount} onChange={function(event) { handleSectionFieldChange("packaging", "labelCount", event.target.value); }} />
              <TextField label="Label Notes" value={formData.packaging.labelNotes} onChange={function(event) { handleSectionFieldChange("packaging", "labelNotes", event.target.value); }} />
              <TextAreaField label="Label Size and Placement" value={formData.packaging.labelSizePlacement} onChange={function(event) { handleSectionFieldChange("packaging", "labelSizePlacement", event.target.value); }} />
              <TextField label="Label Format #1" value={formData.packaging.labelFormat1} onChange={function(event) { handleSectionFieldChange("packaging", "labelFormat1", event.target.value); }} />
              <TextField label="Label Format #2" hint="If necessary" value={formData.packaging.labelFormat2} onChange={function(event) { handleSectionFieldChange("packaging", "labelFormat2", event.target.value); }} />
              <SelectField label="Tray Pack Required" value={formData.packaging.trayPackRequired} onChange={function(event) { handleSectionFieldChange("packaging", "trayPackRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Tray Pack Notes" value={formData.packaging.trayPackNotes} onChange={function(event) { handleSectionFieldChange("packaging", "trayPackNotes", event.target.value); }} />
              <SelectField label="Reuse Tray?" value={formData.packaging.reuseTray} onChange={function(event) { handleSectionFieldChange("packaging", "reuseTray", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Reuse Tray Notes" value={formData.packaging.reuseTrayNotes} onChange={function(event) { handleSectionFieldChange("packaging", "reuseTrayNotes", event.target.value); }} />
              <TextField label="Shelf Life" value={formData.packaging.shelfLife} onChange={function(event) { handleSectionFieldChange("packaging", "shelfLife", event.target.value); }} />
              <TextField label="Shelf Life Notes" value={formData.packaging.shelfLifeNotes} onChange={function(event) { handleSectionFieldChange("packaging", "shelfLifeNotes", event.target.value); }} />
              <SelectField label="Lot Code Required" value={formData.packaging.lotCodeRequired} onChange={function(event) { handleSectionFieldChange("packaging", "lotCodeRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Lot Code Format" value={formData.packaging.lotCodeFormat} onChange={function(event) { handleSectionFieldChange("packaging", "lotCodeFormat", event.target.value); }} />
              <SelectField label="Best By Required" value={formData.packaging.bestByRequired} onChange={function(event) { handleSectionFieldChange("packaging", "bestByRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Best By Format" value={formData.packaging.bestByFormat} onChange={function(event) { handleSectionFieldChange("packaging", "bestByFormat", event.target.value); }} />
              <TextField label="Dieline File / Link" hint="Reference the file handoff in v1" value={formData.packaging.dielineReference} onChange={function(event) { handleSectionFieldChange("packaging", "dielineReference", event.target.value); }} className="md:col-span-2" />
              <SelectField label="Dieline Approval Status" value={formData.packaging.dielineApprovalStatus} onChange={function(event) { handleSectionFieldChange("packaging", "dielineApprovalStatus", event.target.value); }} options={DIELINE_STATUS_OPTIONS} />
              <TextAreaField label="Palletizing Pattern" hint="Example: 13 cases/layer, 8 layers, 104 total/pallet" value={formData.packaging.palletPattern} onChange={function(event) { handleSectionFieldChange("packaging", "palletPattern", event.target.value); }} />
              <TextAreaField label="Pallet Requirements" hint="Chep, standard, customer-specific, etc." value={formData.packaging.palletRequirements} onChange={function(event) { handleSectionFieldChange("packaging", "palletRequirements", event.target.value); }} />
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-[rgb(var(--foreground))]">2c. Service Type Required</div>
                <div className="text-sm text-[rgb(var(--muted))]">Choose the operating mode REV is expected to support for this customer.</div>
              </div>
              <ChoicePills options={SERVICE_TYPE_OPTIONS} values={formData.packaging.serviceTypes || []} onToggle={function(value) { toggleNestedChoice("packaging", "serviceTypes", value); }} />
              {(formData.packaging.serviceTypes || []).indexOf("other") !== -1 ? (
                <TextField label="Other Service Type" value={formData.packaging.otherServiceType} onChange={function(event) { handleSectionFieldChange("packaging", "otherServiceType", event.target.value); }} />
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            id="onboarding-quality"
            icon={ClipboardCheck}
            title="3. Quality & Compliance"
            description="Document the rules that drive QA checks, release control, quarantine behavior, and recall readiness."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="QA Sampling Frequency" value={formData.quality.qaSamplingFrequency} onChange={function(event) { handleSectionFieldChange("quality", "qaSamplingFrequency", event.target.value); }} />
              <TextField label="QA Sampling Notes" value={formData.quality.qaSamplingNotes} onChange={function(event) { handleSectionFieldChange("quality", "qaSamplingNotes", event.target.value); }} />
              <TextAreaField label="QA Hold / Release Procedure" value={formData.quality.holdReleaseProcedure} onChange={function(event) { handleSectionFieldChange("quality", "holdReleaseProcedure", event.target.value); }} />
              <TextAreaField label="QA Quarantine Requirements" value={formData.quality.quarantineRequirements} onChange={function(event) { handleSectionFieldChange("quality", "quarantineRequirements", event.target.value); }} />
              <TextAreaField label="FIFO / FEFO Requirements" value={formData.quality.fifoFefoRequirements} onChange={function(event) { handleSectionFieldChange("quality", "fifoFefoRequirements", event.target.value); }} />
              <TextField label="Recall Contact" value={formData.quality.recallContact} onChange={function(event) { handleSectionFieldChange("quality", "recallContact", event.target.value); }} />
              <TextAreaField
                label="Special Handling Instructions"
                value={formData.quality.specialHandlingNotes}
                onChange={function(event) { handleSectionFieldChange("quality", "specialHandlingNotes", event.target.value); }}
                className="md:col-span-2"
              />
            </div>
          </SectionCard>

          <SectionCard
            id="onboarding-launch"
            icon={CalendarClock}
            title="4. Launch Plan"
            description="Align production timing, first PO readiness, and the expected volume curve so REV can plan capacity with confidence."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <TextField label="Target Production Date" type="date" value={formData.launch.targetProductionDate} onChange={function(event) { handleSectionFieldChange("launch", "targetProductionDate", event.target.value); }} />
              <TextField label="In-Market / Retail Deadline" type="date" value={formData.launch.inMarketDeadline} onChange={function(event) { handleSectionFieldChange("launch", "inMarketDeadline", event.target.value); }} />
              <TextField label="Initial Run Volume (cases)" value={formData.launch.initialRunVolumeCases} onChange={function(event) { handleSectionFieldChange("launch", "initialRunVolumeCases", event.target.value); }} />
              <TextField label="Initial PO #" value={formData.launch.initialPoNumber} onChange={function(event) { handleSectionFieldChange("launch", "initialPoNumber", event.target.value); }} />
              <SelectField label="PO Provided to REV?" value={formData.launch.initialPoProvided} onChange={function(event) { handleSectionFieldChange("launch", "initialPoProvided", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextField label="Projected Monthly Volume (cases)" value={formData.launch.projectedMonthlyVolumeCases} onChange={function(event) { handleSectionFieldChange("launch", "projectedMonthlyVolumeCases", event.target.value); }} />
              <TextField label="Projected Annual Volume (cases)" value={formData.launch.projectedAnnualVolumeCases} onChange={function(event) { handleSectionFieldChange("launch", "projectedAnnualVolumeCases", event.target.value); }} />
              <TextAreaField
                label="Known Lead Time Constraints"
                hint="Label print lead times, can supplier lead times, ingredient sourcing, etc."
                value={formData.launch.leadTimeConstraints}
                onChange={function(event) { handleSectionFieldChange("launch", "leadTimeConstraints", event.target.value); }}
                className="md:col-span-2 xl:col-span-3"
              />
            </div>
          </SectionCard>

          <div id="onboarding-items" className="grid gap-4">
            <SectionCard
              icon={Factory}
              title="5. WIP Item Numbers & Description"
              description="Track the intermediate pack configuration REV will receive or build from."
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-[rgb(var(--muted))]">Capture item number, description, pack count, and palletization.</div>
                <Button type="button" variant="outline" size="sm" onClick={function() { addArrayRow("wipItems", createBlankWipItem); }}>
                  Add WIP Item
                </Button>
              </div>
              <div className="space-y-3">
                {formData.wipItems.map(function(row, index) {
                  return (
                    <div key={"wip-" + index} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">WIP Item #{index + 1}</div>
                        <Button type="button" variant="ghost" size="sm" onClick={function() { removeArrayRow("wipItems", index, createBlankWipItem); }}>
                          Remove
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <TextField label="WIP Item Number" value={row.itemNumber} onChange={function(event) { handleArrayRowChange("wipItems", index, "itemNumber", event.target.value); }} />
                        <TextField label="Item Description" value={row.itemDescription} onChange={function(event) { handleArrayRowChange("wipItems", index, "itemDescription", event.target.value); }} />
                        <TextField label="WIP Case Count" hint="12 or 24 pack" value={row.caseCount} onChange={function(event) { handleArrayRowChange("wipItems", index, "caseCount", event.target.value); }} />
                        <TextField label="Cases Per Pallet" value={row.casesPerPallet} onChange={function(event) { handleArrayRowChange("wipItems", index, "casesPerPallet", event.target.value); }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard
              icon={Boxes}
              title="6. Packaging Item Numbers & Description"
              description="List packaging components with their pallet quantities so procurement and receiving stay aligned."
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-[rgb(var(--muted))]">Cases, trays, film, labels, and other packaging materials.</div>
                <Button type="button" variant="outline" size="sm" onClick={function() { addArrayRow("packagingItems", createBlankPackagingItem); }}>
                  Add Packaging Item
                </Button>
              </div>
              <div className="space-y-3">
                {formData.packagingItems.map(function(row, index) {
                  return (
                    <div key={"packaging-" + index} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Packaging Item #{index + 1}</div>
                        <Button type="button" variant="ghost" size="sm" onClick={function() { removeArrayRow("packagingItems", index, createBlankPackagingItem); }}>
                          Remove
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField label="Packaging Item Number" value={row.itemNumber} onChange={function(event) { handleArrayRowChange("packagingItems", index, "itemNumber", event.target.value); }} />
                        <TextField label="Item Description" value={row.itemDescription} onChange={function(event) { handleArrayRowChange("packagingItems", index, "itemDescription", event.target.value); }} />
                        <TextField label="Quantity Per Pallet" value={row.quantityPerPallet} onChange={function(event) { handleArrayRowChange("packagingItems", index, "quantityPerPallet", event.target.value); }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard
              icon={Package2}
              title="7. Finished Goods & Description"
              description="Capture the finished-good item numbers REV will ship and the expected pallet configuration."
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-[rgb(var(--muted))]">These are the final customer-facing SKUs and shipment units.</div>
                <Button type="button" variant="outline" size="sm" onClick={function() { addArrayRow("finishedGoods", createBlankFinishedGood); }}>
                  Add Finished Good
                </Button>
              </div>
              <div className="space-y-3">
                {formData.finishedGoods.map(function(row, index) {
                  return (
                    <div key={"fg-" + index} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Finished Good #{index + 1}</div>
                        <Button type="button" variant="ghost" size="sm" onClick={function() { removeArrayRow("finishedGoods", index, createBlankFinishedGood); }}>
                          Remove
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <TextField label="Finished Good Item Number" value={row.itemNumber} onChange={function(event) { handleArrayRowChange("finishedGoods", index, "itemNumber", event.target.value); }} />
                        <TextField label="Item Description" value={row.itemDescription} onChange={function(event) { handleArrayRowChange("finishedGoods", index, "itemDescription", event.target.value); }} />
                        <TextField label="Cases Per Pallet" value={row.casesPerPallet} onChange={function(event) { handleArrayRowChange("finishedGoods", index, "casesPerPallet", event.target.value); }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>

          <SectionCard
            id="onboarding-logistics"
            icon={Route}
            title="8. Logistics & Shipping"
            description="Log where product starts, where it ends, and what transportation documentation or carrier rules apply."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextAreaField label="Inbound 3PL / Warehouse (origin)" value={formData.logistics.inboundWarehouse} onChange={function(event) { handleSectionFieldChange("logistics", "inboundWarehouse", event.target.value); }} />
              <TextAreaField label="Outbound 3PL / Warehouse (destination)" value={formData.logistics.outboundWarehouse} onChange={function(event) { handleSectionFieldChange("logistics", "outboundWarehouse", event.target.value); }} />
              <TextAreaField label="Preferred Carrier(s)" value={formData.logistics.preferredCarriers} onChange={function(event) { handleSectionFieldChange("logistics", "preferredCarriers", event.target.value); }} />
              <TextAreaField label="BOL Requirements" value={formData.logistics.bolRequirements} onChange={function(event) { handleSectionFieldChange("logistics", "bolRequirements", event.target.value); }} />
            </div>
          </SectionCard>

          <SectionCard
            id="onboarding-billing"
            icon={ReceiptText}
            title="9. Billing Information"
            description="Capture the AP workflow so invoices, tax info, and credit terms are set up before the first production run."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <TextField label="Billing Contact" value={formData.billing.contactName} onChange={function(event) { handleSectionFieldChange("billing", "contactName", event.target.value); }} />
              <TextField label="Title" value={formData.billing.title} onChange={function(event) { handleSectionFieldChange("billing", "title", event.target.value); }} />
              <TextField label="Email" type="email" value={formData.billing.email} onChange={function(event) { handleSectionFieldChange("billing", "email", event.target.value); }} />
              <TextField label="Phone" value={formData.billing.phone} onChange={function(event) { handleSectionFieldChange("billing", "phone", event.target.value); }} />
              <TextAreaField label="AP Portal / Invoice Submission Method" value={formData.billing.apPortalMethod} onChange={function(event) { handleSectionFieldChange("billing", "apPortalMethod", event.target.value); }} className="md:col-span-2" />
              <TextField label="EIN / Tax ID" value={formData.billing.einTaxId} onChange={function(event) { handleSectionFieldChange("billing", "einTaxId", event.target.value); }} />
              <SelectField label="Pre-Payment Required?" value={formData.billing.prePaymentRequired} onChange={function(event) { handleSectionFieldChange("billing", "prePaymentRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <TextAreaField label="Credit Reference (optional)" value={formData.billing.creditReference} onChange={function(event) { handleSectionFieldChange("billing", "creditReference", event.target.value); }} className="md:col-span-2 xl:col-span-4" />
            </div>
          </SectionCard>

          <SectionCard
            id="onboarding-reporting"
            icon={FileText}
            title="10. Reporting Requirements"
            description="Set expectations for cadence, channel, and the operating drumbeat REV should maintain once the relationship is live."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <SelectField label="Reporting Frequency" value={formData.reporting.reportingFrequency} onChange={function(event) { handleSectionFieldChange("reporting", "reportingFrequency", event.target.value); }} options={REPORTING_FREQUENCY_OPTIONS} />
              <SelectField label="Month-End Reporting Required" value={formData.reporting.monthEndRequired} onChange={function(event) { handleSectionFieldChange("reporting", "monthEndRequired", event.target.value); }} options={YES_NO_OPTIONS} />
              <SelectField label="Operations Call Cadence" value={formData.reporting.operationsCallCadence} onChange={function(event) { handleSectionFieldChange("reporting", "operationsCallCadence", event.target.value); }} options={CALL_CADENCE_OPTIONS} />
              <div className="space-y-1.5 md:col-span-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">Reporting Method Preferred</div>
                <ChoicePills options={REPORTING_METHOD_OPTIONS} values={formData.reporting.reportingMethods || []} onToggle={function(value) { toggleNestedChoice("reporting", "reportingMethods", value); }} />
              </div>
              <TextAreaField
                label="Email Communication / Distribution Lists"
                value={formData.reporting.distributionLists}
                onChange={function(event) { handleSectionFieldChange("reporting", "distributionLists", event.target.value); }}
                className="md:col-span-2"
              />
            </div>
          </SectionCard>

          <SectionCard
            id="onboarding-acknowledgment"
            icon={Send}
            title="11. Additional Notes & Customer Acknowledgment"
            description="Capture context from prior co-packer experiences, pain points, must-haves, and the final customer sign-off."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <TextAreaField label="Additional Notes" value={formData.additionalNotes} onChange={function(event) { handleRootFieldChange("additionalNotes", event.target.value); }} />
              <TextAreaField
                label="Anything REV Should Know?"
                hint="Past co-packer experience, pain points, must-haves, etc."
                value={formData.partnershipNotes}
                onChange={function(event) { handleRootFieldChange("partnershipNotes", event.target.value); }}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),320px]">
              <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-4">
                <div className="mb-3">
                  <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Customer Acknowledgment</div>
                  <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                    By submitting, the customer confirms the information is accurate and understands scope changes can affect cost or timing.
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <TextField label="Full Name" required value={formData.acknowledgment.fullName} onChange={function(event) { handleSectionFieldChange("acknowledgment", "fullName", event.target.value); }} />
                  <TextField label="Title" value={formData.acknowledgment.title} onChange={function(event) { handleSectionFieldChange("acknowledgment", "title", event.target.value); }} />
                  <TextField label="Typed Signature" required hint="Use the signer’s full legal name" value={formData.acknowledgment.signature} onChange={function(event) { handleSectionFieldChange("acknowledgment", "signature", event.target.value); }} />
                  <TextField label="Date" type="date" value={formData.acknowledgment.date} onChange={function(event) { handleSectionFieldChange("acknowledgment", "date", event.target.value); }} />
                </div>
              </div>

              <div className="rounded-xl border border-[rgb(var(--border))] bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">REV Sign-Off</div>
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <div className="font-semibold text-[rgb(var(--foreground))]">Greg Josuweit</div>
                    <div className="text-[rgb(var(--muted))]">VP of Sales</div>
                  </div>
                  <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2 text-[rgb(var(--muted))]">
                    REV Copack LLC
                    <br />
                    200 Research Drive
                    <br />
                    Pittston, PA 18640
                  </div>
                  <div className="text-[rgb(var(--muted))]">Original form dated May 27, 2026.</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-4 py-3">
              <div className="text-sm text-[rgb(var(--muted))]">
                {recordMeta.createdAt ? "Created " + formatDateTime(recordMeta.createdAt) : "New intake"}
                {recordMeta.updatedAt ? " • Last saved " + formatDateTime(recordMeta.updatedAt) : ""}
                {recordMeta.submittedAt ? " • Submitted " + formatDateTime(recordMeta.submittedAt) : ""}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={function() { persistIntake("draft"); }} disabled={saving}>
                  {saving ? "Saving..." : "Save Draft"}
                </Button>
                <Button type="button" variant="default" onClick={function() { persistIntake("submitted"); }} disabled={saving}>
                  {saving ? "Submitting..." : "Submit Intake"}
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
