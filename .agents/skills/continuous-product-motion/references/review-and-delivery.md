# Review the artifact, then deliver it

## Review in layers

**Product and copy:** Confirm what the film actually shows. Source assets from the product or official brand material. Check label lengths, capitalization, marks, and attribution. Mocked conceptual UI must not fabricate named authors, quotations, numerical results, prices, returns, or shipped features.

**Settled frames:** Inspect the hook, action, result, most detailed state, and closing lockup at delivery resolution. Check whitespace, hierarchy, icon consistency, border/shadow restraint, connectors, text contrast, and title/action safety. Also view at likely playback size.

**Handoffs:** Inspect the start, fastest portion, arrival, and settle of every camera move. For a 0.6–1.1 second move, sample several intermediate frames and use playback where available. Look for empty frames, clipped important content once it should be readable, orphaned connectors, world-edge leaks, disappearing objects, double transforms, and a pause between moves. Transitional cropping alone is not a defect; lingering unreadable framing is.

**Timeline determinism:** Seek backward and forward and compare a few representative times. Typing, connectors, emphasis, blur, cursor, and end state must agree regardless of seek order. Fix nondeterministic animation before rendering.

**Sound and rhythm:** Listen with picture when playback is available. Check the first beat, action sounds, major moves, readability, and ending. If audio cannot be heard in the available environment, measure it and say listening remains unverified. Do not present a contact sheet as an audiovisual review.

## Technical checks

Use the installed framework's check/lint/layout/contrast/audio tooling. Fix errors and assess warnings individually. Intentional repeated images or a previously typed line can produce acceptable warnings, but document the reason instead of claiming an entirely clean check.

Render a versioned final file. Use ffprobe or the current equivalent to verify actual encoded dimensions, frame rate, video/audio duration, codecs, and frame count. Extract representative frames from that MP4 and compare with the preview. A successful render command does not prove it encoded the expected composition.

For a constant-rate 17-second, 60 fps film, expect 1,020 frames. Other durations or frame rates have their own contract. Check the actual audio stream, not just the source WAV. Make a poster from a clean deliberate frame with no transitional blur.

Keep concise evidence: storyboard/timings, asset provenance, relevant tool versions, technical check output, encoded contact sheet, audio measurement, and any unresolved visual/listening limits. Keep the source editable with readable scene/element identifiers.

## Render recovery

If an export stalls, distinguish compilation, browser startup, capture, encoding, and assembly from its logs. Check whether output is still advancing before stopping anything. A single-worker retry helped the Drip export, but it is a fallback rather than a permanent setting.

Stop only the task-owned render process when a restart is necessary. Preserve approved files and previous exports. Do not kill unrelated browser/app processes, change system priorities, clear caches broadly, upgrade dependencies blindly, or rerun paid media generation to address a renderer problem. Report the remaining blocker if recovery is not justified.

## Definition of done

The user receives the requested playable artifact, an accurate local path, and a short account of changes and material verification limits. Provide the editable source and poster when relevant. Preserve earlier reviewed versions. Do not end a request for a finished video with only a plan, screenshot, or validation report.

Quality approval belongs to the actual result. Technical passes support it; they cannot guarantee taste, good music, or smooth perceived motion. If a fresh-eye review is available and authorized, scope it to the final artifact and concrete defects rather than asking for generic praise.

## If the film is also being published

Follow the destination's release skill. Asset upload and entry publication are separate states; keep track of both.

For Oren specifically:

- Use the oren-changelog skill. Binaries stay outside Git; the manifest contains their SHA-256 hashes. Upload reviewed assets before deploying references and verify remote/public bytes and video byte-range responses.
- Before preparing an approved public release, check the entry's JSON `status`. A merged `draft` intentionally stays absent from production feed, permalink, and metadata. Do not enable development draft preview in production as a workaround.
- After an authorized deployment, verify the live feed, permalink, canonical/social metadata, poster, and video. HTTP 200 for the video alone does not prove the changelog is visible.
- New mounted public assets may not be recognized by an already-running Next.js process. Verify the mount and bytes before attributing a 404 to upload failure; use the authorized deployment/refresh workflow if the startup file list is stale.

These are conditional publishing checks, not permission to publish a film or merge a PR when the request only covers creative work.
