import { NextResponse } from "next/server";

import { isCategoryId } from "@/lib/categories";
import { insertSubmission, isStoreAvailable, requiresModeration, storeUnavailableReason } from "@/lib/db";
import { isValidLatLon } from "@/lib/geo";
import type { Submission } from "@/lib/types";

export const runtime = "nodejs";

const REPORT_KINDS = ["new", "independent", "chain", "closed"] as const;
type ReportKind = (typeof REPORT_KINDS)[number];

/** Bounds that keep a stray paste or a bot from filling the table. */
const MAX_TEXT = 500;
const MAX_NAME = 160;

function clean(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, limit);
  return trimmed || undefined;
}

export async function POST(request: Request) {
  if (!isStoreAvailable()) {
    return NextResponse.json(
      {
        error: "Submissions aren't available on this deployment.",
        detail: storeUnavailableReason(),
      },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const kindOfReport = (
    REPORT_KINDS.includes(body.kindOfReport as ReportKind)
      ? body.kindOfReport
      : "new"
  ) as ReportKind;

  const correctsPlaceId = clean(body.correctsPlaceId, 200);

  // A correction only needs to say which listing and what's wrong with it.
  if (kindOfReport !== "new") {
    if (!correctsPlaceId) {
      return NextResponse.json(
        { error: "A correction must include `correctsPlaceId`." },
        { status: 400 },
      );
    }

    const saved = insertSubmission({
      name: clean(body.name, MAX_NAME) ?? "(correction)",
      category: "grocery",
      kind: "permanent",
      lat: 0,
      lon: 0,
      description: clean(body.description, MAX_TEXT),
      correctsPlaceId,
      kindOfReport,
    });

    return NextResponse.json(
      { submission: saved, moderated: requiresModeration() },
      { status: 201 },
    );
  }

  // A new place needs enough detail for someone else to actually find it.
  const name = clean(body.name, MAX_NAME);
  const category = typeof body.category === "string" ? body.category : "";
  const lat = Number(body.lat);
  const lon = Number(body.lon);

  if (!name) {
    return NextResponse.json({ error: "`name` is required." }, { status: 400 });
  }
  if (!isCategoryId(category)) {
    return NextResponse.json(
      { error: "`category` must be one of the app's categories." },
      { status: 400 },
    );
  }
  if (!isValidLatLon(lat, lon)) {
    return NextResponse.json(
      { error: "`lat` and `lon` must be valid coordinates." },
      { status: 400 },
    );
  }

  const submission: Submission | null = insertSubmission({
    name,
    category,
    kind: body.kind === "popup" ? "popup" : "permanent",
    lat,
    lon,
    address: clean(body.address, MAX_TEXT),
    website: clean(body.website, MAX_TEXT),
    phone: clean(body.phone, 60),
    openingHours: clean(body.openingHours, MAX_TEXT),
    description: clean(body.description, MAX_TEXT),
    kindOfReport: "new",
  });

  if (!submission) {
    return NextResponse.json({ error: "Could not save the submission." }, { status: 500 });
  }

  return NextResponse.json(
    { submission, moderated: requiresModeration() },
    { status: 201 },
  );
}

export async function GET() {
  return NextResponse.json({
    available: isStoreAvailable(),
    moderated: requiresModeration(),
    reportKinds: REPORT_KINDS,
  });
}
