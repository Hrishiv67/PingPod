// Timer location check: the phone's position is compared with PingPod's (set by staff in Admin →
// Settings). It's only sent with "Start playing" and never stored. The database makes the final
// call; the app checks first so it can explain the problem nicely.
import type { Settings } from "./types";

export interface GeoFix {
  lat: number;
  lng: number;
  /** The phone's own estimate of how far off it might be, in metres. */
  accuracy: number;
}

/** Same allowance as the database: phone accuracy counts, up to 150 m (indoor location is fuzzy). */
export const MAX_ACCURACY_ALLOWANCE = 150;

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** True when the timer needs the player's location before it can start. */
export function needsLocation(s: Settings): boolean {
  return Boolean(s.geofence_enabled && s.venue_lat != null && s.venue_lng != null);
}

/** Within the venue radius, allowing for the phone's accuracy (capped). */
export function atVenue(s: Settings, fix: GeoFix): boolean {
  if (!needsLocation(s)) return true;
  const d = distanceM(fix.lat, fix.lng, s.venue_lat!, s.venue_lng!);
  return d <= (s.geofence_m ?? 300) + Math.min(Math.max(fix.accuracy || 0, 0), MAX_ACCURACY_ALLOWANCE);
}

/** "0.4 mi" / "2.3 mi" for messages (US venue). */
export function milesAway(s: Settings, fix: GeoFix): string {
  const mi = distanceM(fix.lat, fix.lng, s.venue_lat!, s.venue_lng!) / 1609.34;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

export type LocationProblem = "denied" | "unavailable" | "timeout" | "unsupported";
export class LocationError extends Error {
  kind: LocationProblem;
  constructor(message: string, kind: LocationProblem) {
    super(message);
    this.kind = kind;
  }
}

/** One fresh position from the phone (asks for permission the first time). */
export function currentFix(timeoutMs = 12_000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation)
      return reject(new LocationError("This browser can't share your location.", "unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) =>
        reject(
          err.code === err.PERMISSION_DENIED
            ? new LocationError("Location is off for this site.", "denied")
            : err.code === err.TIMEOUT
              ? new LocationError("Couldn't find your location in time.", "timeout")
              : new LocationError("Couldn't find your location.", "unavailable"),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
