import { Instrument_Serif } from "next/font/google";
import { ButtonLink } from "@/components/elements/button";
import { Main } from "@/components/elements/main";
import { GitHubIcon } from "@/components/icons/social/github-icon";
import {
  FooterLink,
  FooterWithLinksAndSocialIcons,
  SocialLink,
} from "@/components/sections/footer-with-links-and-social-icons";
import { NavbarLogo, NavbarWithLogoAndActions } from "@/components/sections/navbar-with-logo-and-actions";
import { REPO_URL, SITE_NAME } from "@/lib/site";

/**
 * Shared chrome (navbar + footer) for the marketing pages.
 *
 * This is a route group: `(site)` is not part of the URL, so the page at
 * app/(site)/about/page.tsx is served at /about. It exists so these pages can
 * share a layout while the editor at `/` stays a bare full-screen app. New
 * content pages (privacy policy, changelog, ...) go in this folder.
 *
 * The display font is self-hosted by next/font. Don't load it from a font CDN
 * with a <link>: the site's Content Security Policy only allows same-origin
 * fonts and styles.
 */
const display = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} flex min-h-dvh flex-col bg-olive-950`}>
      <NavbarWithLogoAndActions
        id="navbar"
        logo={
          <NavbarLogo href="/" aria-label={`${SITE_NAME} home`}>
            <span className="grid size-6 place-items-center rounded bg-olive-100 text-[11px] font-bold text-olive-950">
              R
            </span>
            <span className="text-sm font-semibold tracking-tight text-white">{SITE_NAME}</span>
          </NavbarLogo>
        }
        actions={<ButtonLink href="/">Open the editor</ButtonLink>}
      />

      <Main className="flex-1">{children}</Main>

      <FooterWithLinksAndSocialIcons
        id="footer"
        links={
          <>
            <FooterLink href="/">Editor</FooterLink>
            <FooterLink href="/about">About</FooterLink>
          </>
        }
        socialLinks={
          <SocialLink href={REPO_URL} name="Source code on GitHub" rel="noopener noreferrer">
            <GitHubIcon aria-hidden="true" />
          </SocialLink>
        }
        fineprint="Runs entirely in your browser. Your photos never leave your device."
      />
    </div>
  );
}
