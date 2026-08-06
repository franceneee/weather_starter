# Add a privacy-preserving “Use my location” flow

## Problem Statement

Weather Starter currently requires users to type latitude and longitude manually before they can add a Singapore location. This is awkward for users who simply want weather for where they are now. Users need a one-click way to detect their position, resolve it to the nearest supported Singapore forecast area, and add or select that area without exposing precise device coordinates unnecessarily.

The flow must work on trustworthy HTTP loopback origins used during local development, remain usable when browser geolocation is unavailable or denied, avoid duplicate locations caused by GPS jitter, and distinguish forecast-area resolution from weather retrieval so a temporary weather-provider failure does not prevent a known area from being saved.

## Solution

Add a persistent **Use my location** button beside the existing manual **Add Location** action. A direct click requests a browser position using low-power, cached geolocation settings. The browser submits the detected coordinates transiently to the backend, which validates that they are within Singapore, resolves the nearest canonical forecast area, and persists only that area's canonical identity and coordinates.

If the canonical area is new, it is created and selected. If it already exists, the existing location is selected and refreshed instead of creating a duplicate. Forecast-area identity is stored independently from mutable weather data. If area resolution succeeds but weather refresh fails, the location is still returned with an empty weather snapshot carrying the canonical area name.

The UI provides distinct inline failure messages, never retries geolocation automatically, and always leaves manual coordinate entry available.

## User Stories

1. As a Weather Starter user, I want to add my current area with one click, so that I do not need to know or type coordinates.
2. As a user, I want the location request to begin only after I click the button, so that the browser permission prompt is expected and understandable.
3. As a user, I want to see “Detecting location…” while the browser determines my position, so that I know the action is in progress.
4. As a user, I want to see “Adding location…” after detection succeeds, so that I can distinguish device positioning from server processing.
5. As a user, I want repeated clicks disabled while detection or creation is running, so that I do not accidentally submit duplicate requests.
6. As a user in Singapore, I want my detected position mapped to the nearest supported forecast area, so that the dashboard displays meaningful area-based weather.
7. As a privacy-conscious user, I want my precise detected coordinates used only transiently, so that my home or workplace position is not persisted.
8. As a privacy-conscious user, I want exact detected coordinates excluded from routine analytics and logs, so that sensitive location data is not retained indirectly.
9. As a returning user, I want an already-saved forecast area selected and refreshed, so that GPS jitter does not create duplicate cards.
10. As a user, I want manual coordinate entry to remain available, so that I can continue when automatic detection is unsuitable.
11. As a user who denies location permission, I want a clear inline explanation, so that I understand why detection stopped.
12. As a user whose position cannot be determined, I want a specific “position unavailable” message, so that I can choose manual entry.
13. As a user on a slow or unresponsive location provider, I want detection to time out, so that the UI does not remain busy indefinitely.
14. As a user on a browser without geolocation support, I want an unsupported-browser message, so that I know to use manual entry.
15. As a user on an untrusted non-loopback HTTP origin, I want an insecure-context explanation, so that I know HTTPS is required.
16. As a user detected outside Singapore, I want a clear validation message and no saved location, so that unsupported coordinates do not enter the dashboard.
17. As a user affected by a temporary forecast-area resolution failure, I want a retryable error and no partially identified location, so that the database remains consistent.
18. As a user affected by a weather refresh failure after area resolution, I want the known area to remain saved, so that I can refresh it later.
19. As a local developer, I want geolocation to work on trustworthy localhost and loopback URLs without HTTPS, so that local development remains simple.
20. As a local developer, I want failures to be deterministic in automated tests, so that permission and provider edge cases do not become flaky.
21. As a maintainer, I want canonical forecast-area identity separate from weather snapshots, so that deduplication does not depend on mutable provider data.
22. As a maintainer, I want legacy locations migrated safely, so that adding a unique canonical area field does not corrupt existing saved data.
23. As an assistive-technology user, I want progress and errors announced accessibly, so that I can complete the flow without relying on visual changes alone.
24. As a user, I want the detected location selected after success, so that its weather appears immediately without another click.

## Implementation Decisions

- Display **Use my location** alongside the existing **Add Location** action even when the manual form is collapsed.
- Request geolocation directly from the button's click handler rather than from mount-time effects or automatic retries.
- Use low-power positioning defaults: high accuracy disabled, a ten-second timeout, and cached positions up to five minutes old.
- Check geolocation availability and secure-context eligibility before requesting a position. Trustworthy HTTP loopback origins remain supported; non-loopback deployments require HTTPS.
- Keep exact browser coordinates only long enough to complete the create request. Do not retain them in client state beyond the active operation or include them in interaction analytics.
- Make the backend the sole owner of Singapore bounds validation, nearest forecast-area resolution, canonicalization, and deduplication.
- Separate area resolution from weather retrieval. Resolution returns a canonical key, display name, latitude, and longitude.
- Add a unique canonical forecast-area key and canonical area name to the locations schema. Persist canonical area coordinates instead of exact device coordinates.
- Store forecast-area identity independently from the weather snapshot.
- Resolve the canonical area before insertion. If resolution fails, write no record and return a retryable service error.
- If a canonical area already exists, refresh and return it instead of inserting another row.
- Continue accepting latitude and longitude on the create endpoint. Return the selected location directly: status 201 for a newly created area and status 200 for an existing deduplicated area.
- Return status 422 with a user-presentable detail for coordinates outside Singapore.
- Return status 503 with a retryable detail when area resolution is unavailable.
- If weather retrieval fails after successful resolution, return the canonical location with an empty weather snapshot whose area contains the canonical display name.
- Select the location ID returned by the create endpoint directly and reload the collection without inferring which item was added.
- Use one busy state for detection and creation, disabling automatic and manual concurrent submission.
- Distinguish unsupported browser, insecure context, permission denied, position unavailable, timeout, outside Singapore, area-resolution failure, weather failure, and general server failure.
- Never request permission again automatically. Keep manual entry available after every failure.
- Record only operation stage, resolved area when available, and categorical outcome in routine interaction events.
- Backfill existing rows from their stored weather area when possible. Give unresolved legacy rows a migration-only deterministic key based on record identity; never use a shared value such as “unknown.”
- Establish uniqueness only after migration backfill.
- Announce progress and errors through an appropriate live region and expose busy/disabled state on the button.

## Testing Decisions

- Assert externally observable behavior and public contracts rather than hook state, internal helper calls, SQL statements, or provider request ordering.
- Use a frontend seam that renders the location control with its real store behavior while replacing only browser geolocation and the application API boundary.
- Cover successful detection and selection, permission denial, unavailable position, timeout, unsupported browser, insecure context, busy labels, repeated-submission prevention, manual-entry availability, and privacy-safe analytics at the frontend seam.
- Extend the existing Express/Supertest locations API integration seam with injected area-resolution and weather clients.
- Cover bounds rejection, canonical persistence, absence of exact device coordinates, creation, existing-area selection and refresh, coordinate-jitter deduplication, resolution failure without insertion, and weather failure with successful insertion at the backend seam.
- Keep nearest-area calculation and provider-shape coverage with the existing weather-client tests.
- Follow existing locations API test patterns for temporary database isolation, dependency injection, response assertions, and persistence verification.
- Verify migration behavior using a representative legacy database row.
- Verify locally with both a direct loopback URL and the named localhost URL when the latter resolves to loopback.
- Require all new paths plus the existing build, lint, formatting check, and test suite to pass before completion.

## Out of Scope

- Continuous or background location tracking.
- Automatically changing areas as the user moves.
- Persisting exact device coordinates.
- Reverse-geocoding or displaying a street address.
- Supporting non-Singapore locations.
- Enabling geolocation over untrusted production HTTP origins.
- Replacing or removing manual coordinate entry.
- Adding a map-based location picker.
- Redesigning the dashboard beyond the new control, progress, and error states.
- Changing forecast providers beyond separating area resolution from weather retrieval.
- Automatically retrying denied permission or provider failures.
- Introducing a new full-browser end-to-end framework solely for this feature.

## Further Notes

- Browser permission lifetime and prompting behavior remain controlled by the user agent.
- Named localhost URLs must resolve to loopback; the application cannot correct operating-system DNS configuration.
- A generic canonical-area default such as “unknown” is invalid because it undermines uniqueness. Weather refresh failure uses known resolved area identity, while area-resolution failure remains a no-write error.
- The agreed two-seam testing strategy reflects that browser permission behavior and backend persistence live in different runtimes. It reuses existing backend integration patterns and avoids introducing a larger full-browser harness.
