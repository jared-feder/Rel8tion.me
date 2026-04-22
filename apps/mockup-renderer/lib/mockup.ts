import { formatOpenHouseRange } from "./time";

export type MockupRenderInput = {
  agentName: string | null;
  brokerage: string | null;
  address: string | null;
  cityStateZip?: string | null;
  openStart: string | null;
  openEnd: string | null;
  propertyImageUrl: string | null;
  agentPhotoUrl: string | null;
  rel8tionUrl: string;
};

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return input.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function renderMockupSvg(input: MockupRenderInput): Promise<Buffer> {
  const width = 1200;
  const height = 1200;

  const address = truncate(input.address || "Open House", 70);
  const brokerage = truncate(input.brokerage || "REL8TION", 60);
  const agentName = truncate(input.agentName || "Local Listing Agent", 45);
  const dateLine = truncate(formatOpenHouseRange(input.openStart, input.openEnd), 80);
  const cityStateZip = truncate(input.cityStateZip || "", 70);
  const propertyImage = input.propertyImageUrl ? escapeXml(input.propertyImageUrl) : "";
  const agentPhoto = input.agentPhotoUrl ? escapeXml(input.agentPhotoUrl) : "";
  const rel8tionUrl = escapeXml(input.rel8tionUrl);

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#eef4ff"/>
        <stop offset="100%" stop-color="#dbeafe"/>
      </linearGradient>
      <linearGradient id="cta" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#40c8ff"/>
        <stop offset="100%" stop-color="#2563eb"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#0f172a" flood-opacity="0.12"/>
      </filter>
      <clipPath id="heroClip">
        <rect x="40" y="40" width="1120" height="580" rx="36" ry="36"/>
      </clipPath>
      <clipPath id="avatarClip">
        <circle cx="145" cy="757" r="74"/>
      </clipPath>
    </defs>

    <rect width="1200" height="1200" fill="url(#bg)"/>
    <circle cx="150" cy="140" r="180" fill="#bfdbfe" opacity="0.35"/>
    <circle cx="1040" cy="1080" r="220" fill="#93c5fd" opacity="0.22"/>

    <g filter="url(#shadow)">
      <rect x="40" y="40" width="1120" height="580" rx="36" ry="36" fill="#0f172a"/>
      ${propertyImage ? `<image href="${propertyImage}" x="40" y="40" width="1120" height="580" preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>` : `<rect x="40" y="40" width="1120" height="580" rx="36" ry="36" fill="#0084B4"/>`}
      <rect x="40" y="460" width="1120" height="160" rx="0" ry="0" fill="#0f172a" opacity="0.42" clip-path="url(#heroClip)"/>
    </g>

    <g filter="url(#shadow)">
      <rect x="40" y="660" width="1120" height="500" rx="36" ry="36" fill="#ffffff" opacity="0.98"/>
    </g>

    ${agentPhoto ? `<circle cx="145" cy="757" r="78" fill="#ffffff"/><image href="${agentPhoto}" x="71" y="683" width="148" height="148" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>` : `<circle cx="145" cy="757" r="78" fill="#dbeafe"/><text x="145" y="770" text-anchor="middle" style="font:800 42px Arial,sans-serif; fill:#1d4ed8;">A</text>`}

    <text x="240" y="755" style="font:700 34px Arial,sans-serif; fill:#0084B4; letter-spacing:1px;">REL8TION OPEN HOUSE CONNECT</text>
    <text x="70" y="905" style="font:800 56px Arial,sans-serif; fill:#0E1420;">${escapeXml(address)}</text>
    <text x="70" y="965" style="font:600 34px Arial,sans-serif; fill:#48556A;">${escapeXml(dateLine)}</text>
    <text x="70" y="1025" style="font:700 30px Arial,sans-serif; fill:#0E1420;">${escapeXml(agentName)} • ${escapeXml(brokerage)}</text>
    ${cityStateZip ? `<text x="70" y="1075" style="font:600 26px Arial,sans-serif; fill:#64748B;">${escapeXml(cityStateZip)}</text>` : ``}
    <text x="70" y="1120" style="font:700 28px Arial,sans-serif; fill:#0E1420;">Tap in. Capture leads. Follow up instantly.</text>

    <rect x="760" y="1030" rx="18" ry="18" width="360" height="90" fill="url(#cta)"/>
    <text x="940" y="1088" text-anchor="middle" style="font:800 32px Arial,sans-serif; fill:white;">View Demo</text>
    <text x="70" y="1160" style="font:600 24px Arial,sans-serif; fill:#64748B;">${rel8tionUrl}</text>
  </svg>`;

  return Buffer.from(svg, "utf-8");
}
