import { join } from "node:path";
import sharp from "sharp";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

const markData = await sharp(join(process.cwd(), "public", "oren-mark.svg"))
  .resize(64, 64)
  .png()
  .toBuffer();

/** A static, server-safe rendering of the Oren mark for browser chrome. */
export default function Icon() {
  return new Response(markData, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
    },
  });
}
