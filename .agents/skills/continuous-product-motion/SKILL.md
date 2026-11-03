---
name: continuous-product-motion
description: Create or refine premium product launch films with a continuous camera, minimal copy, crisp product UI, purposeful choreography, and energetic sound. Use for the Oren Drip film style or requests to match its motion quality; not for ordinary application transitions or footage editing.
---

# Continuous product motion

Produce a product film with the clarity, restraint, momentum, and finish of the approved Oren Drip v4 film. Use its craft as the benchmark; adapt the story and identity to the actual product.

## Start with the product

- Read the request, existing project, and product implementation or supplied references. Identify one user action and the useful result it produces. Separate shipped behavior from planned behavior.
- For an existing film, preserve approved work and follow the latest feedback. Identify whether the problem is copy, layout, choreography, pacing, sound, or rendering before changing it.
- Use the available HyperFrames entry skill for video production. This skill supplies creative direction and quality criteria; the installed framework skills own the current render contract and commands. Honor an explicitly chosen alternative framework.
- Use stageshow when available for constructed product UI, and media-use for music, effects, icons, and brand assets. Search the available registry before building a named effect. Do not block ordinary work if an optional layout kit is absent.
- For the first use of this style, read [the benchmark](references/benchmark.md) and view its bundled contact sheet. For animation implementation read [motion recipes](references/motion-recipes.md). Before delivery read [review and delivery](references/review-and-delivery.md).

## Build a short, visual argument

Write the beat plan before polishing frames: **hook → action → result → meaning → brand**. Combine or omit beats when the product warrants it. Each scene communicates one idea through a visible action.

- Hook within the first second. Start with the product object, a source relationship, or a strong short line. An empty chat box is a weak default opening.
- Keep copy at headline or interface-label length. Show one real question or command when needed. Let the resulting UI explain the feature instead of adding an explanatory paragraph.
- Do not introduce writing, saving, publishing, trading, or another feature just to fill a beat. In the benchmark, a thesis-writing scene was removed because it distracted from research.
- Prefer a relationship or transformation to a row of empty cards. Inputs connect, evidence groups, results resolve, and a selected control produces a visible change. Detail must explain something rather than decorate empty space.
- Close with one short outcome line and a clean brand lockup. In Oren partnership films, feature first and partner attribution at the end unless directed otherwise. Use the official partner mark.

## Art direction

Use these as starting values, then adapt to the product's established identity:

- White or quiet off-white canvas; near-black text; fine light-gray borders; soft, diffuse shadows. Large negative space around a substantial focal object.
- One consistent geometric sans. The benchmark uses local Instrument Sans, restrained medium weights, and tight headline tracking. Preserve legibility before matching its tracking.
- Color comes from content and a restrained accent. Preserve original brand marks and mascot colors. Avoid adding grain, heavy gradients, neon, or decorative texture to this style.
- Use the product's icon system with consistent stroke weight, optical size, and containers. Oren uses named Hugeicons rendered with HugeiconsIcon. Do not substitute emoji or invented interface glyphs. Brand logos remain original assets.
- Compose at delivery resolution and inspect at the size people will actually watch. A beautiful full-screen frame can become unreadable inside a social feed or changelog player.

## Camera and choreography

The viewer should feel one continuous journey across a larger world.

- Place scenes in a coherent shared coordinate system and move one camera/world transform. Keep object identity across handoffs. Continuous motion must be visible; hiding a scene replacement behind blur is not enough.
- Bring the important object toward the center. Plan both endpoints and the intervening path; a diagonal move must not expose irrelevant neighboring scenes or an empty canvas.
- Default to fast starts and long, soft deceleration: expo.out or power4.out for major entrances and camera travel. A small resolving scale move can follow the main travel.
- Start the next useful action while the previous motion is settling. Do not launch competing tweens on the same camera properties. Check actual motion continuity; matching ease names does not guarantee matching velocity.
- Keep one dominant move at a time. Supporting UI can cascade, but should not compete with the camera. Use restrained 40–80 ms staggers, short press dips around 0.96 scale, and quick clean settles.
- Use slight scale and blur-to-sharp on entering UI; keep reading states sharp. Optional directional blur belongs only to fast travel and must not hide mistakes.
- Avoid linear movement for expressive camera/UI motion, hard cuts in this continuous-camera direction, repeated decorative loops, cartoon bounce, and overshoot that makes text swim.

## Pacing and sound

- Target the shortest film that communicates the feature. The benchmark improved from 22 to 17 seconds by trimming idle holds, not globally speeding up every animation.
- Give each key state enough time to read, then leave. Start with roughly 0.4–0.8 seconds of clear reading time for a short label; allow more for an actual question. Measure this after the text becomes sharp and the camera lands.
- Keep the approved camera easing when tightening pacing. Cut dead space between actions first. Do not drag out the end card merely to fill the music.
- For a new launch, choose a fresh cue unless reuse was requested or approved. For revisions, preserve approved music unless feedback calls for a change. Follow the media workflow's generation and cost rules.
- Seek an immediate groove, memorable hook, and a satisfying finish. The benchmark's winning direction was punchy electro-funk/future-house around 128 BPM, not sparse ambient or generic corporate background music. Genre is adaptable; energy and musical structure are the criteria.
- Align major moves to audible phrases or beats using the actual file. A generation prompt requesting accents at specific seconds does not prove the returned track hits them.
- Add quiet clicks, typing, and short airy movement effects only where actions happen. Music should energize the film without burying those details. Read the audio recipe before mastering.

## Implementation and delivery standard

- Keep animation seekable and deterministic, with a paused master timeline and framework-owned media timing. No live APIs, wall-clock timers, unseeded randomness, or callback-driven typing that breaks on a seek.
- Lock layout geometry before animating. Type into reserved space, reveal responses without reflow, and keep connectors attached to the objects they explain.
- Default to the benchmark's 1920×1080, 60 fps for this motion style unless the requested format differs. Recompose for a different aspect ratio rather than cropping the landscape blindly.
- Save versioned exports and retain the editable source. Inspect intermediate handoffs and the encoded MP4, not just settled preview frames. Technical checks passing does not establish creative quality.
- Deliver the requested playable video, useful poster, source location, and concise verification result. Do not claim that audio was listened to, playback reviewed, or a file published unless that happened.
- Creating the film does not itself authorize uploading, publishing, merging, or deploying. When those are requested, follow the destination's workflow and verify the result. For an approved changelog release, explicitly check the entry's publication status; merging a draft does not make it visible.

## Acceptance decision

Before calling it finished, answer these from the final artifact:

1. Can the viewer understand the feature with sound off and without explanatory paragraphs?
2. Does the first second earn attention, and does every action create a visible result?
3. Is each scene more specific than generic cards containing icons?
4. Does the camera carry attention continuously without blank handoffs, clipped reading states, or sudden stops?
5. Does the music have energy and a deliberate ending, and are effects tied to the visible actions?
6. Have delivery dimensions, duration, audio, render warnings, and transition frames been verified?

If a criterion fails, fix that specific cause. More effects, longer copy, or a louder master are not substitutes for a clear scene.
