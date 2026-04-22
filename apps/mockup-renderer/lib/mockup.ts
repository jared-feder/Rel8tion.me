import sharp from "sharp";
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

async function fetchImageBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

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

export async function renderMockupJpg(input: MockupRenderInput): Promise<Buffer> {
  const width = 1200;
  const height = 1200;

  const address = truncate(input.address || "Open House", 70);
  const brokerage = truncate(input.brokerage || "REL8TION", 60);
  const agentName = truncate(input.agentName || "Local Listing Agent", 45);
  const dateLine = truncate(formatOpenHouseRange(input.openStart, input.openEnd), 80);

  const propertyBuffer = await fetchImageBuffer(input.propertyImageUrl);
  const agentBuffer = await fetchImageBuffer(input.agentPhotoUrl);

  const base = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 242, g: 246, b: 255, alpha: 1 }
    }
  });

  const layers: sharp.OverlayOptions[] = [];

  if (propertyBuffer) {
    const property = await sharp(propertyBuffer)
      .resize(width, 620, { fit: "cover", position: "center" })
      .jpeg({ quality: 88 })
      .toBuffer();

    layers.push({ input: property, top: 0, left: 0 });
  } else {
    const fallbackHero = await sharp({
      create: {
        width,
        height: 620,
        channels: 4,
        background: { r: 0, g: 132, b: 180, alpha: 1 }
      }
    }).png().toBuffer();

    layers.push({ input: fallbackHero, top: 0, left: 0 });
  }

  const whiteCard = await sharp({
    create: {
      width: 1120,
      height: 500,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.98 }
    }
  }).png().toBuffer();

  layers.push({ input: whiteCard, left: 40, top: 660 });

  if (agentBuffer) {
    const avatar = await sharp(agentBuffer)
      .resize(150, 150, { fit: "cover", position: "attention" })
      .composite([
        {
          input: Buffer.from(`<svg width="150" height="150"><circle cx="75" cy="75" r="74" fill="white"/></svg>`),
          blend: "dest-in"
        }
      ])
      .png()
      .toBuffer();

    layers.push({ input: avatar, left: 70, top: 700 });
  }

  const svg = Buffer.from(`
    <svg width="${width}" height="${height}">
      <style>
        .kicker { font: 700 34px Arial, sans-serif; fill: #0084B4; }
        .title  { font: 800 56px Arial, sans-serif; fill: #0E1420; }
        .meta   { font: 600 34px Arial, sans-serif; fill: #48556A; }
        .body   { font: 700 30px Arial, sans-serif; fill: #0E1420; }
        .small  { font: 600 26px Arial, sans-serif; fill: #64748B; }
        .cta    { font: 800 32px Arial, sans-serif; fill: white; }
      </style>

      <text x="240" y="755" class="kicker">REL8TION OPEN HOUSE CONNECT</text>
      <text x="70" y="905" class="title">${escapeXml(address)}</text>
      <text x="70" y="965" class="meta">${escapeXml(dateLine)}</text>
      <text x="70" y="1025" class="body">${escapeXml(agentName)} • ${escapeXml(brokerage)}</text>
      <text x="70" y="1080" class="small">Tap in. Capture leads. Follow up instantly.</text>

      <rect x="760" y="1030" rx="18" ry="18" width="360" height="90" fill="#0084B4"/>
      <text x="820" y="1088" class="cta">View Demo</text>
      <text x="70" y="1160" class="small">${escapeXml(input.rel8tionUrl)}</text>
    </svg>
  `);

  return base
    .composite([...layers, { input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}