import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { CategoryId, PlaceKind, Submission } from "./types";

/**
 * Storage for user submissions and corrections.
 *
 * SQLite keeps this dependency-free for anyone cloning the repo — no database to
 * provision before `npm run dev` works. The trade-off is that serverless hosts
 * (Vercel, Netlify) have a read-only filesystem, so submissions won't persist
 * there. Everything below is deliberately behind this one module: swapping in
 * Postgres means reimplementing these functions, not touching the app.
 *
 * Set SMALLBOX_DB_PATH to relocate the file.
 */

const DB_PATH = process.env.SMALLBOX_DB_PATH ?? path.join(process.cwd(), "data", "smallbox.db");

let db: Database.Database | null = null;
let openFailed: string | null = null;

function connect(): Database.Database | null {
  if (db) return db;
  if (openFailed) return null;

  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const handle = new Database(DB_PATH);
    handle.pragma("journal_mode = WAL");
    handle.exec(`
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'permanent',
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        address TEXT,
        website TEXT,
        phone TEXT,
        opening_hours TEXT,
        description TEXT,
        corrects_place_id TEXT,
        kind_of_report TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS submissions_latlon ON submissions (lat, lon);
      CREATE INDEX IF NOT EXISTS submissions_corrects ON submissions (corrects_place_id);
    `);
    db = handle;
    return db;
  } catch (error) {
    // A read-only filesystem is an expected deployment, not a crash.
    openFailed = error instanceof Error ? error.message : String(error);
    console.warn("[smallbox] submissions database unavailable:", openFailed);
    return null;
  }
}

export function isStoreAvailable(): boolean {
  return connect() !== null;
}

export function storeUnavailableReason(): string | undefined {
  connect();
  return openFailed ?? undefined;
}

/** Submissions are visible immediately unless moderation is switched on. */
export function requiresModeration(): boolean {
  return process.env.SMALLBOX_MODERATE_SUBMISSIONS === "1";
}

interface Row {
  id: number;
  name: string;
  category: string;
  kind: string;
  lat: number;
  lon: number;
  address: string | null;
  website: string | null;
  phone: string | null;
  opening_hours: string | null;
  description: string | null;
  corrects_place_id: string | null;
  kind_of_report: string;
  created_at: string;
  approved: number;
}

function toSubmission(row: Row): Submission {
  return {
    id: row.id,
    name: row.name,
    category: row.category as CategoryId,
    kind: row.kind as PlaceKind,
    lat: row.lat,
    lon: row.lon,
    address: row.address ?? undefined,
    website: row.website ?? undefined,
    phone: row.phone ?? undefined,
    openingHours: row.opening_hours ?? undefined,
    description: row.description ?? undefined,
    correctsPlaceId: row.corrects_place_id ?? undefined,
    kindOfReport: row.kind_of_report as Submission["kindOfReport"],
    createdAt: row.created_at,
    approved: row.approved === 1,
  };
}

export type NewSubmission = Omit<Submission, "id" | "createdAt" | "approved">;

export function insertSubmission(input: NewSubmission): Submission | null {
  const handle = connect();
  if (!handle) return null;

  const createdAt = new Date().toISOString();
  const approved = requiresModeration() ? 0 : 1;

  const result = handle
    .prepare(
      `INSERT INTO submissions
        (name, category, kind, lat, lon, address, website, phone, opening_hours,
         description, corrects_place_id, kind_of_report, created_at, approved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.category,
      input.kind,
      input.lat,
      input.lon,
      input.address ?? null,
      input.website ?? null,
      input.phone ?? null,
      input.openingHours ?? null,
      input.description ?? null,
      input.correctsPlaceId ?? null,
      input.kindOfReport,
      createdAt,
      approved,
    );

  return {
    ...input,
    id: Number(result.lastInsertRowid),
    createdAt,
    approved: approved === 1,
  };
}

/**
 * Approved new-place submissions inside a bounding box.
 *
 * A box is a cheap prefilter the index can serve; the caller applies the exact
 * radius afterwards.
 */
export function findSubmissionsNear(
  lat: number,
  lon: number,
  radiusMetres: number,
): Submission[] {
  const handle = connect();
  if (!handle) return [];

  const latDelta = radiusMetres / 111_320;
  // Guard the pole case, where the longitude span goes to infinity.
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const lonDelta = radiusMetres / (111_320 * cosLat);

  const rows = handle
    .prepare(
      `SELECT * FROM submissions
       WHERE approved = 1 AND kind_of_report = 'new'
         AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
    )
    .all(lat - latDelta, lat + latDelta, lon - lonDelta, lon + lonDelta) as Row[];

  return rows.map(toSubmission);
}

/** Corrections filed against specific listings, keyed by place id. */
export function findCorrections(placeIds: string[]): Map<string, Submission[]> {
  const byPlace = new Map<string, Submission[]>();
  const handle = connect();
  if (!handle || placeIds.length === 0) return byPlace;

  // Chunked to stay under SQLite's parameter limit on large result sets.
  const CHUNK = 400;
  for (let i = 0; i < placeIds.length; i += CHUNK) {
    const chunk = placeIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = handle
      .prepare(
        `SELECT * FROM submissions
         WHERE approved = 1 AND corrects_place_id IN (${placeholders})`,
      )
      .all(...chunk) as Row[];

    for (const row of rows) {
      const submission = toSubmission(row);
      const key = submission.correctsPlaceId!;
      const list = byPlace.get(key) ?? [];
      list.push(submission);
      byPlace.set(key, list);
    }
  }

  return byPlace;
}
