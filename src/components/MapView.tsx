"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

import { CATEGORIES } from "@/lib/categories";
import type { Place } from "@/lib/types";

interface MapViewProps {
  center: { lat: number; lon: number };
  radius: number;
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Fired when the user pans/zooms away from the current search centre. */
  onMoved: (center: { lat: number; lon: number }) => void;
}

function pinIcon(place: Place, selected: boolean): L.DivIcon {
  const def = CATEGORIES[place.category];
  return L.divIcon({
    className: "",
    html: `<div class="pin${selected ? " pin-selected" : ""}" style="background:${def.color}"><span>${def.emoji}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}

/**
 * Keeps the Leaflet view in sync with centre changes coming from outside.
 *
 * The size check matters: on mobile the map sits inside a `display:none` panel
 * until the user switches to the map tab, and Leaflet's zoom maths divides by
 * the container size. Calling flyToBounds on a 0x0 container yields
 * `Invalid LatLng object: (NaN, NaN)`. So we wait for real dimensions, and a
 * ResizeObserver re-runs the effect the moment the panel is shown.
 */
function ViewSync({
  center,
  radius,
}: {
  center: { lat: number; lon: number };
  radius: number;
}) {
  const map = useMap();
  const applied = useRef<string>("");
  const [sizeTick, setSizeTick] = useState(0);

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      setSizeTick((n) => n + 1);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon)) return;

    const key = `${center.lat},${center.lon},${radius}`;
    if (applied.current === key) return;

    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return; // Hidden; the observer will retry.

    applied.current = key;
    // Fit the search circle rather than guessing a zoom level.
    const bounds = L.latLng(center.lat, center.lon).toBounds(radius * 2);
    map.flyToBounds(bounds, { duration: 0.6, maxZoom: 16 });
  }, [center, radius, map, sizeTick]);

  return null;
}

function MoveWatcher({ onMoved }: { onMoved: (c: { lat: number; lon: number }) => void }) {
  useMapEvents({
    moveend(event) {
      const c = event.target.getCenter();
      onMoved({ lat: c.lat, lon: c.lng });
    },
  });
  return null;
}

/** Pans just enough to bring a newly selected place into view. */
function SelectionFocus({ place }: { place: Place | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!place) return;
    const target = L.latLng(place.lat, place.lon);
    if (!map.getBounds().pad(-0.15).contains(target)) {
      map.panTo(target, { animate: true });
    }
  }, [place, map]);
  return null;
}

export default function MapView({
  center,
  radius,
  places,
  selectedId,
  onSelect,
  onMoved,
}: MapViewProps) {
  const selected = useMemo(
    () => places.find((p) => p.id === selectedId),
    [places, selectedId],
  );

  return (
    <MapContainer
      center={[center.lat, center.lon]}
      zoom={13}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      <Circle
        center={[center.lat, center.lon]}
        radius={radius}
        pathOptions={{
          // A literal colour, not a CSS variable: Leaflet writes this into an
          // SVG presentation attribute, where var() support is patchy.
          color: "#15803d",
          weight: 1,
          opacity: 0.5,
          fillOpacity: 0.04,
        }}
      />

      {places.map((place) => (
        <Marker
          key={place.id}
          position={[place.lat, place.lon]}
          icon={pinIcon(place, place.id === selectedId)}
          zIndexOffset={place.id === selectedId ? 1000 : 0}
          eventHandlers={{ click: () => onSelect(place.id) }}
          title={place.name}
        />
      ))}

      <ViewSync center={center} radius={radius} />
      <SelectionFocus place={selected} />
      <MoveWatcher onMoved={onMoved} />
    </MapContainer>
  );
}
