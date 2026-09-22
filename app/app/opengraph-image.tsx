import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

export const runtime = "nodejs";
export const alt = "Oren — your intelligent investing agent for tokenized stock portfolios.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const publicDir = join(process.cwd(), "public");

const [heroBuffer, displayFont, textFont, markSvg] = await Promise.all([
  readFile(join(publicDir, "oren-editorial-landscape-hero.webp")),
  readFile(join(publicDir, "fonts", "NeueFreigeistTest-Medium-BF670f2d93af06e.otf")),
  readFile(join(publicDir, "fonts", "NeueFreigeistTest-Regular-BF670f2d93a6313.otf")),
  readFile(join(publicDir, "oren-mark.svg")),
]);

// Satori's image renderer reliably supports PNG but not WebP data URLs.
const heroData = await sharp(heroBuffer).png().toBuffer();
const heroSrc = `data:image/png;base64,${heroData.toString("base64")}`;
const markData = await sharp(markSvg).png().toBuffer();
const markSrc = `data:image/png;base64,${markData.toString("base64")}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#f9f9f7",
        color: "#111110",
        display: "flex",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      <img
        alt=""
        height="630"
        src={heroSrc}
        style={{ height: "630px", objectFit: "cover", objectPosition: "center", position: "absolute", width: "1200px" }}
        width="1200"
      />
      <div
        style={{
          background: "linear-gradient(90deg, rgba(249,249,247,0.98) 0%, rgba(249,249,247,0.91) 42%, rgba(249,249,247,0.2) 70%, rgba(249,249,247,0) 100%)",
          display: "flex",
          height: "100%",
          position: "absolute",
          width: "100%",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "36px",
          height: "100%",
          justifyContent: "flex-start",
          padding: "58px 60px 48px",
          position: "relative",
          width: "690px",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "14px" }}>
          <img alt="" src={markSrc} style={{ height: "52px", width: "52px" }} />
          <span style={{ fontFamily: "Oren Display", fontSize: "22px", letterSpacing: "0.2em" }}>OREN</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontFamily: "Oren Display", fontSize: "73px", letterSpacing: "-0.065em", lineHeight: "0.93" }}>
            The market never stops. Neither does Oren.
          </span>
          <span style={{ color: "#5f5f5a", fontFamily: "Oren Text", fontSize: "22px", lineHeight: "1.35", marginTop: "22px", width: "560px" }}>
            Your intelligent investing agent for researching, building and managing tokenized stock portfolios.
          </span>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { data: displayFont, name: "Oren Display", style: "normal", weight: 500 },
        { data: textFont, name: "Oren Text", style: "normal", weight: 400 },
      ],
    },
  );
}
