import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "RAW editor",
    "DNG editor",
    "online photo editor",
    "browser photo editor",
    "RAW photo editing",
    "xmp presets",
    "white balance",
    "tone curve",
    "color grading",
    "WebGL",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
    // Image comes from app/opengraph-image.tsx (file convention).
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SITE_DESCRIPTION,
    // Image falls back to the Open Graph image.
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  category: "photography",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <head>
        {/* Stop the browser from navigating to (i.e. downloading) a dropped
            file in the window before React has hydrated and attached the
            editor's own drag-and-drop handlers. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "addEventListener('dragover',function(e){e.preventDefault()});addEventListener('drop',function(e){e.preventDefault()});",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col overscroll-none">
        {children}
        {/* Page-view analytics. Loads from and reports to this origin
            (/_vercel/insights/*), so it fits the same-origin policy. */}
        <Analytics />
      </body>
    </html>
  );
}
