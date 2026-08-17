/**
 * Curated regional market guides.
 *
 * These are the pages where local-food organisations publish the markets they
 * actually track — the Edible magazine network, state agriculture departments,
 * regional food councils. They carry exactly what OpenStreetMap lacks: current
 * seasons, weekday schedules, and the markets too new or too small to have
 * been mapped. Each entry is fetched and read by the same Claude extraction
 * pass as the news source, so adding a region is one entry here, not a scraper.
 *
 * Checklist for adding an entry:
 *  - The page is a genuine directory (a list of markets, not one article).
 *  - robots.txt permits fetching it.
 *  - `region` is the circle the guide claims to cover; the provider only
 *    fetches it when a search overlaps that circle.
 */

export interface DirectoryEntry {
  /** Stable id used for caching and provenance refs. */
  id: string;
  /** Publisher, shown in the detail panel. */
  label: string;
  url: string;
  /** Area description passed to extraction ("Places outside this are skipped"). */
  areaName: string;
  region: { lat: number; lon: number; radiusKm: number };
}

export const DIRECTORY_REGISTRY: DirectoryEntry[] = [
  {
    id: "edible-ohio-valley",
    label: "Edible Ohio Valley — Weekly Farmers Market Guide",
    url: "https://www.edibleohiovalley.com/farmers-markets",
    areaName: "Greater Cincinnati and Dayton, Ohio (including Northern Kentucky)",
    // Midpoint of the Cincinnati–Dayton corridor; the guide's own scope.
    region: { lat: 39.45, lon: -84.4, radiusKm: 110 },
  },
];
