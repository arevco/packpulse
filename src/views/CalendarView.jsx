import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

var TEAM_CALENDAR_EMBED_URL = "https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FNew_York&src=Y185MGM1MWU3ZTY1ZjBjNWE4Njg0ZWVlZjg3MDA2NDA5YmM3ZDM0ZWY1OTk1YWQ3ZTFiMmJlMDlkMzM5YmNlODNkQGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20&src=ZmdudThhdDhzaGFia2VhbTY1MGVzZDUxN2k1MXAwdmNAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23c0ca33&color=%23d81b60";

export default function CalendarView() {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[rgb(var(--border))] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">Team Calendar</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Shared Google Calendar embedded directly in PackPulse for team schedule visibility.
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={TEAM_CALENDAR_EMBED_URL} target="_blank" rel="noreferrer">
              Open in Google Calendar
            </a>
          </Button>
        </div>
        <div className="bg-[rgb(var(--background))] p-2 sm:p-4">
          <iframe
            title="PackPulse team calendar"
            src={TEAM_CALENDAR_EMBED_URL}
            className="block h-[72vh] min-h-[560px] w-full rounded-md border border-[rgb(var(--border))] bg-white"
            frameBorder="0"
            scrolling="no"
            loading="lazy"
          />
        </div>
      </Card>
    </div>
  );
}
