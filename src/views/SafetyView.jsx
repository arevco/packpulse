import { useState } from "react";
import {
  BarChart3,
  ClipboardList,
  FileText,
  LockKeyhole,
  ShieldAlert,
  Siren,
} from "lucide-react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";

var SAFETY_TABS = [
  { key: "inbox", label: "Inbox", icon: ShieldAlert },
  { key: "log", label: "OSHA Log", icon: ClipboardList },
  { key: "annual", label: "Annual Summary", icon: FileText },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
];

function SummaryStat(props) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-2xl font-semibold text-[rgb(var(--foreground))]">{props.value}</div>
        <div className="mt-1 text-xs font-medium uppercase tracking-[0.08em] text-[rgb(var(--muted))]">{props.label}</div>
        <div className="mt-2 text-xs text-[rgb(var(--muted))]">{props.detail}</div>
      </CardContent>
    </Card>
  );
}

function EmptyPanel(props) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 border-b border-[rgb(var(--border))] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-base font-semibold text-[rgb(var(--foreground))]">{props.title}</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">{props.description}</div>
        </div>
        {props.badge ? <Badge variant={props.badgeVariant || "info"}>{props.badge}</Badge> : null}
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {props.points.map(function(point) {
          return (
            <div key={point} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2 text-sm text-[rgb(var(--muted))]">
              {point}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function SafetyView() {
  const [activeTab, setActiveTab] = useState("inbox");

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-[rgb(var(--border))]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-[rgb(var(--foreground))]">Safety</div>
                <Badge variant="warning">Planning Ready</Badge>
                <Badge variant="secondary">First UI Slice</Badge>
              </div>
              <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
                PackPulse's OSHA workspace will manage incident intake, deterministic recordability review,
                `300` / `300A` / `301` workflows, and de-identified safety analytics without turning the app into a generic EHS suite.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="active" size="sm" disabled>
                Report Incident
              </Button>
              <Button variant="outline" size="sm" disabled>
                Export 300A
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryStat value="0" label="Open Intakes" detail="New incident drafts and submitted cases awaiting review." />
            <SummaryStat value="0" label="Severe Reports Due" detail="Fatality and severe injury deadlines tracked separately from the log." />
            <SummaryStat value="0" label="Recordables YTD" detail="Deterministic OSHA recordables for the selected establishment and year." />
            <SummaryStat value="0.00" label="DART Rate" detail="Calculated from recordable cases and total hours worked once annual inputs exist." />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {SAFETY_TABS.map(function(tab) {
          var Icon = tab.icon;
          return (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "active" : "outline"}
              size="sm"
              onClick={function() { setActiveTab(tab.key); }}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {activeTab === "inbox" ? (
        <EmptyPanel
          title="Inbox"
          description="Daily entry point for incident capture, review queues, and severe-report timing."
          badge="Next build slice"
          points={[
            "Quick-capture wizard should let a supervisor report an incident in under two minutes.",
            "Review queue should flag recordability decisions due within 7 calendar days.",
            "Severe-report candidates should surface 8-hour and 24-hour deadlines immediately.",
          ]}
        />
      ) : null}

      {activeTab === "log" ? (
        <EmptyPanel
          title="OSHA Log"
          description="Year-based case log aligned to Form 300 with row detail for 301 and update history."
          badge="Deterministic only"
          badgeVariant="info"
          points={[
            "Recordability and annual totals should be computed from deterministic server logic, not AI output.",
            "Privacy concern cases should show `privacy case` in the log and keep names in a separate confidential table.",
            "Filters will include year, establishment, workflow status, recordability status, privacy case, and severe-report status.",
          ]}
        />
      ) : null}

      {activeTab === "annual" ? (
        <EmptyPanel
          title="Annual Summary"
          description="300A workflow for hours worked, annual average employees, certification, and export readiness."
          badge="Compliance workflow"
          badgeVariant="success"
          points={[
            "Annual average employees and hours worked should be explicit inputs until a trusted payroll/timekeeping source exists.",
            "Executive certification should snapshot the summary for audit history.",
            "This panel should eventually support print-ready 300A and ITA CSV export.",
          ]}
        />
      ) : null}

      {activeTab === "analytics" ? (
        <EmptyPanel
          title="Analytics"
          description="De-identified trend analysis that connects safety to shift, area, and operational context."
          badge="Restricted detail"
          badgeVariant="warning"
          points={[
            "General operations users should see counts and trends, not private 301 detail.",
            "Core metrics include total recordable case rate, DART, recordables by month, and days since last recordable.",
            "This is where PackPulse can connect safety outcomes to line, shift, and area patterns without leaking medical detail.",
          ]}
        />
      ) : null}

      <Card>
        <CardHeader className="border-b border-[rgb(var(--border))]">
          <div className="flex flex-wrap items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-[rgb(var(--muted))]" />
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Build Notes</div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-4 text-sm text-[rgb(var(--muted))]">
          <div>The repo now includes an implementation spec, planned API contracts, safety KPI definitions, and a Supabase schema proposal for OSHA logging.</div>
          <div>The next coding step is to add the safety server routes and start hydrating this shell from real summary data.</div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary">Private detail separated</Badge>
            <Badge variant="secondary">Summary-first loading</Badge>
            <Badge variant="secondary">State-plan aware later</Badge>
            <Badge variant="warning">
              <Siren className="h-3.5 w-3.5" />
              Severe reporting tracked separately
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
