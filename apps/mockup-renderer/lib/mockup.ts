import sharp from "sharp";

const FOREGROUND_SIGN_URL =
  "https://nicanqrfqlbnlmnoernb.supabase.co/storage/v1/object/public/outreach-mockups/jared-sign-foreground.png";

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

function escapeXml(value: string | null | undefined): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fallbackPropertySvg(input: MockupRenderInput, width: number, height: number): Buffer {
  const address = escapeXml(input.address || "Upcoming Open House");
  const brokerage = escapeXml(input.brokerage || "REL8TION");
  const agent = escapeXml(input.agentName || "Your host agent");

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#58d2ef"/>
          <stop offset="0.52" stop-color="#edf9ff"/>
          <stop offset="1" stop-color="#f8fbff"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="32%" r="56%">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.96"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="1200" fill="url(#sky)"/>
      <circle cx="245" cy="175" r="210" fill="url(#glow)"/>
      <circle cx="930" cy="165" r="170" fill="#ffffff" opacity="0.55"/>
      <rect x="112" y="104" width="976" height="394" rx="56" fill="#ffffff" opacity="0.76"/>
      <text x="600" y="238" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="42" font-weight="800" fill="#172c76">${brokerage}</text>
      <text x="600" y="318" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="900" fill="#101a42">${address}</text>
      <text x="600" y="390" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#526071">Hosted by ${agent}</text>
    </svg>
  `);
}

export async function renderMockupJpg(input: MockupRenderInput): Promise<Buffer> {
  const width = 1200;
  const height = 1200;

  const propertyBuffer = await fetchImageBuffer(input.propertyImageUrl);
  const foregroundBuffer = await fetchImageBuffer(FOREGROUND_SIGN_URL);

  const base = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 242, g: 246, b: 255, alpha: 1 }
    }
  });

  const layers: sharp.OverlayOptions[] = [];

  const property = await sharp(propertyBuffer || fallbackPropertySvg(input, width, height))
    .resize(width, height, { fit: "cover", position: "center" })
    .jpeg({ quality: 88 })
    .toBuffer();

  layers.push({ input: property, top: 0, left: 0 });

  if (foregroundBuffer) {
    const foreground = await sharp(foregroundBuffer)
      .resize(Math.round(width * 0.92), Math.round(height * 0.94), {
        fit: "contain",
        position: "center"
      })
      .png()
      .toBuffer();

    const metadata = await sharp(foreground).metadata();
    const overlayWidth = metadata.width ?? width;
    const overlayHeight = metadata.height ?? height;

    layers.push({
      input: foreground,
      left: Math.min(width - overlayWidth, Math.round((width - overlayWidth) / 2) + 28),
      top: Math.max(0, height - overlayHeight)
    });
  }

  return base
    .composite(layers)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}
