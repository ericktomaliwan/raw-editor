import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return [
    // No lastModified: a request-time Date would make this route dynamic
    // under cacheComponents; a static sitemap is all a site this small needs.
    {
      url: base.toString(),
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: new URL("/about", base).toString(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
