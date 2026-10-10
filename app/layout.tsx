import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAW Editor",
  description:
    "Browser-based photo editor with professional tone and color adjustments and .xmp preset support. Everything runs locally on your GPU.",
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
      <body className="min-h-full flex flex-col overscroll-none">{children}</body>
    </html>
  );
}
