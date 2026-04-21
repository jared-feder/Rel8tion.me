export function formatOpenHouseRange(openStart: string | null, openEnd: string | null): string {
  if (!openStart) return "Open house details coming soon";

  const start = new Date(openStart);
  const end = openEnd ? new Date(openEnd) : null;

  const startText = start.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  if (!end) return `${startText} ET`;

  const endText = end.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit"
  });

  return `${startText} – ${endText} ET`;
}
