import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FEATURES = ["DNG & RAW", "Tone curves", "HSL & grading", ".xmp presets", "GPU rendering"];

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #09090b 0%, #18181b 60%, #1c1917 100%)",
          color: "#e4e4e7",
          fontFamily: "sans-serif",
        }}
      >
        {/* Accent gradient — hints at a colour ramp */}
        <div
          style={{
            position: "absolute",
            right: -160,
            top: -160,
            width: 620,
            height: 620,
            borderRadius: 9999,
            background:
              "radial-gradient(circle at 30% 30%, rgba(56,189,248,0.35), rgba(249,115,22,0.25) 55%, transparent 72%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "#fafafa",
              color: "#09090b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            R
          </div>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 900 }}>
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 28, color: "#a1a1aa", maxWidth: 900 }}>
            Open a DNG or camera RAW, grade it on the GPU, export. Nothing leaves your device.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {FEATURES.map((f) => (
            <div
              key={f}
              style={{
                padding: "10px 18px",
                borderRadius: 9999,
                border: "1px solid #3f3f46",
                background: "rgba(24,24,27,0.8)",
                fontSize: 22,
                color: "#d4d4d8",
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
