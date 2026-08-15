"use client";

import { useState } from "react";

import { CATEGORY_LIST } from "@/lib/categories";
import type { CategoryId, PlaceKind } from "@/lib/types";

interface AddPlaceDialogProps {
  /** Where the pin goes — the map's current centre. */
  center: { lat: number; lon: number };
  onClose: () => void;
  onAdded: () => void;
}

/**
 * The form that lets the data get better.
 *
 * Location comes from the map centre rather than a draggable pin: it keeps the
 * form to one screen, and "pan the map to the spot" is a thing people already
 * know how to do.
 */
export default function AddPlaceDialog({ center, onClose, onAdded }: AddPlaceDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CategoryId>("farmers_market");
  const [kind, setKind] = useState<PlaceKind>("permanent");
  const [address, setAddress] = useState("");
  const [openingHours, setOpeningHours] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("A name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          kind,
          lat: center.lat,
          lon: center.lon,
          address: address || undefined,
          openingHours: openingHours || undefined,
          website: website || undefined,
          description: description || undefined,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save.");

      setDone(true);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const field =
    "w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent";

  return (
    <div
      className="fixed inset-0 z-[2000] grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add a place"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="scroll-thin max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-surface shadow-xl">
        <header className="flex items-center gap-3 border-b border-edge px-4 py-3">
          <h2 className="flex-1 text-base font-semibold">Add a place</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-muted hover:bg-surface-muted"
          >
            ✕
          </button>
        </header>

        {done ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm font-medium">Thank you — it&apos;s on the map.</p>
            <p className="mt-1 text-xs text-muted">
              Community additions outrank automated sources, so yours wins any
              disagreement.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 px-4 py-3">
            <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-muted">
              The pin goes at the centre of the map —{" "}
              <span className="tabular-nums">
                {center.lat.toFixed(4)}, {center.lon.toFixed(4)}
              </span>
              . Close this and pan the map if that isn&apos;t right.
            </p>

            <label className="block">
              <span className="text-xs text-muted">Name</span>
              <input
                className={field}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Hollow Creek Roadside Stand"
                required
                maxLength={160}
              />
            </label>

            <div className="flex gap-2">
              <label className="flex-1">
                <span className="text-xs text-muted">Type</span>
                <select
                  className={field}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryId)}
                >
                  {CATEGORY_LIST.map((def) => (
                    <option key={def.id} value={def.id}>
                      {def.emoji} {def.singular}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex-1">
                <span className="text-xs text-muted">Runs</span>
                <select
                  className={field}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as PlaceKind)}
                >
                  <option value="permanent">Regular hours</option>
                  <option value="popup">Pop-up / seasonal</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-muted">Address (optional)</span>
              <input
                className={field}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="12 Hollow Creek Road"
                maxLength={500}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted">
                Hours (optional) — e.g. <code>Sa 08:00-14:00</code>
              </span>
              <input
                className={field}
                value={openingHours}
                onChange={(e) => setOpeningHours(e.target.value)}
                placeholder="Sa 08:00-14:00"
                maxLength={500}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted">Website (optional)</span>
              <input
                className={field}
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://"
                maxLength={500}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted">Anything else (optional)</span>
              <textarea
                className={`${field} min-h-16 resize-y`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Peaches and tomatoes, honour box, cash only"
                maxLength={500}
              />
            </label>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-edge px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Add place"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
