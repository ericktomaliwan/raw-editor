import type { Metadata } from "next";
import { ButtonLink, PlainButtonLink } from "@/components/elements/button";
import { CameraIcon } from "@/components/icons/camera-icon";
import { ChevronIcon } from "@/components/icons/chevron-icon";
import { CpuIcon } from "@/components/icons/cpu-icon";
import { LockIcon } from "@/components/icons/lock-icon";
import { PhotoIcon } from "@/components/icons/photo-icon";
import { SlidersIcon } from "@/components/icons/sliders-icon";
import { SparklesIcon } from "@/components/icons/sparkles-icon";
import { CallToActionSimple } from "@/components/sections/call-to-action-simple";
import { Feature, FeaturesThreeColumn } from "@/components/sections/features-three-column";
import { HeroSimpleLeftAligned } from "@/components/sections/hero-simple-left-aligned";
import {
  Stat,
  StatsThreeColumnWithDescription,
} from "@/components/sections/stats-three-column-with-description";
import { RAW_EXTENSIONS } from "@/lib/image";
import { JsonLd } from "@/components/JsonLd";
import {
  getSiteUrl,
  REPO_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SOCIAL_IMAGE,
} from "@/lib/site";

/*
 * Search-result copy. Titles display up to roughly 60 characters and
 * descriptions roughly 155 before being cut off, so both are written to fit,
 * with the terms people search for ("free", "RAW", "DNG", "browser") up front.
 */
const TITLE = `About ${SITE_NAME}: Free, Private RAW Editing in Your Browser`;
const DESCRIPTION =
  "RAW Editor is a free online photo editor for DNG and camera RAW files. It runs entirely in your browser, so nothing is uploaded. See how it works.";
const FEATURES = [
  "RAW and DNG decoding on your device",
  "White balance, exposure, highlights, shadows, whites and blacks",
  "Texture, clarity, dehaze, vibrance and saturation",
  "Tone curve, eight-band color mixer and color grading",
  "Sharpening, vignette, fade and grain",
  "Crop with aspect ratio presets",
  "Built-in High Detail preset, plus .xmp preset import",
  "Export JPEG, PNG and WebP at full resolution",
];

export const metadata: Metadata = {
  // `absolute` skips the root layout's "%s · RAW Editor" template: the site
  // name is already in the title.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/about" },
  // Nested metadata objects replace the root layout's wholesale, so the fields
  // that should carry over (including the share image) are repeated here.
  openGraph: {
    type: "website",
    url: "/about",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

/**
 * Structured data (schema.org) describing this page and the app it is about,
 * so search engines can read "what is this" without inferring it from prose:
 * the site, the web application (free, runs in any browser), this About page,
 * and a breadcrumb trail. Every value mirrors what the page itself says.
 */
function structuredData() {
  const origin = getSiteUrl();
  const home = new URL("/", origin).toString();
  const page = new URL("/about", origin).toString();
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        url: home,
        name: SITE_NAME,
        description: SITE_TAGLINE,
        inLanguage: "en",
      },
      {
        "@type": "WebApplication",
        "@id": `${home}#app`,
        name: SITE_NAME,
        url: home,
        description: SITE_DESCRIPTION,
        applicationCategory: "MultimediaApplication",
        applicationSubCategory: "Photo editor",
        operatingSystem: "Any",
        browserRequirements: "Requires a current browser with WebAssembly and WebGL 2.",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: FEATURES,
        image: new URL(SOCIAL_IMAGE.url, origin).toString(),
      },
      {
        "@type": "AboutPage",
        "@id": `${page}#webpage`,
        url: page,
        name: TITLE,
        description: DESCRIPTION,
        inLanguage: "en",
        isPartOf: { "@id": `${home}#website` },
        about: { "@id": `${home}#app` },
        mainEntity: { "@id": `${home}#app` },
        breadcrumb: { "@id": `${page}#breadcrumb` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${page}#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: home },
          { "@type": "ListItem", position: 2, name: "About", item: page },
        ],
      },
    ],
  };
}

/*
 * Page = a stack of section components, each fed its copy through props.
 * To change the page, edit the copy here or swap a section; the layout and
 * styling live in components/sections and components/elements.
 *
 * Keep every claim on this page true of the shipped app. In particular the
 * file-type count is read from the decoder's own list so it can't drift.
 */
export default function AboutPage() {
  return (
    <>
      <JsonLd data={structuredData()} />
      {/* Hero */}
      <HeroSimpleLeftAligned
        id="hero"
        headline="A RAW photo editor that lives in your browser."
        subheadline={
          <>
            <p>
              {SITE_NAME} opens DNG and camera RAW files, along with JPEG, PNG, WebP, AVIF and TIFF, and gives
              you the tone and color controls photographers already know.
            </p>
            <p>There is nothing to install and no account to create. Drop in a photo and start editing.</p>
          </>
        }
        cta={
          <div className="flex flex-wrap items-center gap-4">
            <ButtonLink href="/" size="lg">
              Open the editor
            </ButtonLink>
            <PlainButtonLink href={REPO_URL} size="lg" target="_blank" rel="noopener noreferrer">
              View the source <ChevronIcon aria-hidden="true" />
            </PlainButtonLink>
          </div>
        }
      />

      {/* What it does */}
      <FeaturesThreeColumn
        id="features"
        eyebrow="What it does"
        headline="Everything you need for a single photo, from first look to export."
        subheadline={
          <p>
            The editor covers the core of a RAW workflow: decode the file, shape tone and color, apply a look,
            and save the result.
          </p>
        }
        features={
          <>
            <Feature
              icon={<CameraIcon aria-hidden="true" />}
              headline="Real RAW decoding"
              subheadline={
                <p>
                  Sensor data is demosaiced on your device, using the white balance your camera recorded. If a
                  file can&apos;t be decoded, its embedded preview is opened and clearly labeled.
                </p>
              }
            />
            <Feature
              icon={<SlidersIcon aria-hidden="true" />}
              headline="Tone and color tools"
              subheadline={
                <p>
                  White balance, exposure, highlights and shadows, texture, clarity and dehaze, a tone curve, an
                  eight-band color mixer, color grading, calibration, sharpening, vignette, fade and grain, plus a
                  crop tool with the common aspect ratios.
                </p>
              }
            />
            <Feature
              icon={<CpuIcon aria-hidden="true" />}
              headline="Edits at the speed of the slider"
              subheadline={
                <p>
                  Every adjustment runs on your graphics card, so the preview keeps up as you drag. The export
                  is rendered with the same pipeline, so what you see is what you save.
                </p>
              }
            />
            <Feature
              icon={<SparklesIcon aria-hidden="true" />}
              headline="Bring your own presets"
              subheadline={
                <p>
                  Start from the built-in High Detail look, or import{" "}
                  <span className="whitespace-nowrap">.xmp</span> presets one at a time or as a whole folder.
                  Imported presets stay in your browser, grouped the way the pack organized them.
                </p>
              }
            />
            <Feature
              icon={<PhotoIcon aria-hidden="true" />}
              headline="Full-resolution export"
              subheadline={
                <p>
                  Save as JPEG, PNG or WebP at the photo&apos;s full size. JPEGs use the MozJPEG encoder with a
                  quality setting you choose, for smaller files at lower settings.
                </p>
              }
            />
            <Feature
              icon={<LockIcon aria-hidden="true" />}
              headline="Private by design"
              subheadline={
                <p>
                  Your photo is opened, edited and exported on your own device. It is never sent to a server,
                  because there is no server-side processing to send it to.
                </p>
              }
            />
          </>
        }
      />

      {/* How it works */}
      <StatsThreeColumnWithDescription
        id="how-it-works"
        heading="Your photos stay on your device."
        description={
          <>
            <p>
              Most online editors upload your file and process it somewhere else. This one downloads the editor
              to you instead: RAW decoding runs in WebAssembly, and image processing runs in WebGL on your own
              hardware.
            </p>
            <p>
              The site counts page views with cookie-free analytics, so we know whether anyone is using it. Your
              photos, edits and presets are never part of that.
            </p>
          </>
        }
      >
        <Stat stat="0" text="Photos uploaded. Decoding, editing and export all happen locally." />
        <Stat
          stat={RAW_EXTENSIONS.length}
          text="Camera RAW file types recognized, including DNG, CR3, NEF, ARW and RAF."
        />
        <Stat stat="3" text="Export formats: JPEG with adjustable quality, PNG and WebP." />
      </StatsThreeColumnWithDescription>

      {/* What to expect */}
      <FeaturesThreeColumn
        id="expectations"
        eyebrow="Good to know"
        headline="What to expect, honestly."
        subheadline={<p>A browser-based editor makes a few trade-offs. These are the ones worth knowing up front.</p>}
        features={
          <>
            <Feature
              headline="A neutral starting point"
              subheadline={
                <p>
                  RAW files open without the tone mapping and sharpening your camera or phone applies in its own
                  viewer. Expect a flatter, softer image to begin with, ready for you to shape.
                </p>
              }
            />
            <Feature
              headline="Presets are interpreted"
              subheadline={
                <p>
                  Tone, color, curve and grading settings in a preset are applied through this editor&apos;s own
                  pipeline, so results are close rather than identical. Lens corrections and local adjustments
                  are skipped.
                </p>
              }
            />
            <Feature
              headline="One photo at a time"
              subheadline={
                <p>
                  There is no library and no batch processing. Open a photo, edit it, export it. Your edits are
                  kept when you swap in another photo, which makes it easy to reuse a look.
                </p>
              }
            />
          </>
        }
      />

      {/* Call to action */}
      <CallToActionSimple
        id="call-to-action"
        headline="Ready to edit a photo?"
        subheadline={<p>Open the editor and drop a file anywhere on the page. It works with what you already shoot.</p>}
        cta={
          <div className="flex items-center gap-4">
            <ButtonLink href="/" size="lg">
              Open the editor
            </ButtonLink>
          </div>
        }
      />
    </>
  );
}
