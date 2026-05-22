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

export async function renderMockupJpg(input: MockupRenderInput): Promise<Buffer> {
  const width = 1200;
  const height = 1200;

  if (!input.propertyImageUrl?.trim()) {
    throw new Error("Missing listing photo URL. Outreach mockup requires the actual listing image.");
  }

  const propertyBuffer = await fetchImageBuffer(input.propertyImageUrl);
  if (!propertyBuffer) {
    throw new Error("Listing photo could not be loaded. Outreach mockup was not rendered with a generic background.");
  }

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

  const property = await sharp(propertyBuffer)
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
