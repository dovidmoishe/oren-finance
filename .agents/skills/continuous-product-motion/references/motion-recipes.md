# Motion and sound recipes

These recipes translate the visual direction into implementation choices. Use the installed framework's current syntax and lifecycle; do not replace its media or composition contract with these snippets.

## Shared camera

For a frame W×H and a target at world coordinates cx,cy, scaling the world by s places the target at the frame center when:

```js
x = W / 2 - cx * s;
y = H / 2 - cy * s;
```

Set the world's transform origin to `0 0`. Animate that world transform rather than independently moving every card to simulate a pan. Example GSAP choreography inside the framework's paused timeline:

```js
function cameraTo(tl, world, cx, cy, scale, at, duration, W, H) {
  tl.to(world, {
    x: W / 2 - cx * scale,
    y: H / 2 - cy * scale,
    scale,
    duration,
    ease: 'expo.out',
  }, at);
}
```

Use one camera owner. A resolving scale move follows the principal travel; supporting UI may overlap it. Avoid overlapping camera tweens on x/y/scale. For a genuinely uninterrupted traveling path, design successive keyframes with compatible velocity; two separate ease-outs ordinarily decelerate twice.

Lay out the path at a wide overview before rendering. Ensure useful outgoing content survives until incoming content begins to establish itself. A zoom-through can use a button, badge, letter, or white surface, but only when the relationship makes visual sense. A smooth pan is preferable to an arbitrary zoom through every scene.

## Entrance and focus

Start ordinary UI near its final position: approximately 12–24 px offset, 0.92–0.98 scale, opacity 0, and 4–8 px blur; reveal over 0.3–0.55 seconds with power4.out. Stagger related elements by 0.04–0.08 seconds. Use larger travel only when the movement communicates grouping or causality.

Keep the visual hierarchy stable through the entrance. Blur is temporary; headings, body text, and fine connectors must settle sharp. If a spring is appropriate, constrain overshoot to a small 2–5% and a quick settle. An ease-out with a small resolving move can be cleaner than a spring.

When softening off-center UI, keep the target sharp and preserve enough outgoing structure to orient the viewer. Do not smear the full frame, animate heavy blur constantly, or grade real footage with arbitrary CSS effects; use the media-treatment workflow for footage.

## UI actions that feel authored

- Reserve the final composer and response dimensions. Type text at a plausible variable rhythm with a few short pauses; keep this a finite timeline function. A typo is optional and only useful when it adds character without obscuring the message.
- For seek-safe typing, place characters in the source markup and schedule their visibility, or derive a substring from timeline time. Do not append characters in timers or one-way callbacks. Caret blinking must be finite and deterministic too.
- Move the pointer purposefully to the control, pause briefly, press, then release. Confirm the action in the same control or result region. Avoid a cursor tour through every icon.
- A button can dip to 0.96 scale for roughly 0.15 seconds and release in 0.2–0.25 seconds. Click sound lands on the press.
- Dropdowns cascade; panels reveal a useful state; a scroll exposes information. Each interaction must change something the viewer can see.
- Avoid animating content and its parent in opposing directions without checking their combined screen-space motion.

## Connected evidence or grouped results

Use this when a simple icon grid lacks product meaning:

1. Choose the central object: stock, document, request, account, project, or output.
2. Choose a few short truthful input labels. Prefer three to six meaningful fragments to twelve tiny cards.
3. Place groups around the hub with intentional asymmetry and breathing room.
4. Reveal fragments with a directional fan or cascade. Use source/type icons to preserve continuity from earlier scenes.
5. Draw connectors after the relationships become visible, then apply one small emphasis or resolving state.

Anchor connector endpoints to card edges and hub attachment points. For SVG drawing, initialize each path's dash array and offset using its actual length, or use a normalized `pathLength` consistently. Do not hard-code one pixel length across unequal paths and assume they all finish together. Seeking halfway must produce the same partial strokes as forward playback.

A balance rail is appropriate only when it explains the concept. Do not imply exact scores, consensus, analysis results, or activity counts without real data. An unnumbered conceptual movement still needs a clear context.

## Pacing pass

Mark the first frame each key message is fully readable and the first frame it begins leaving. Review the interval between them, not the whole scene duration. If a scene drags:

1. Remove idle time after the useful result.
2. Start the next supporting action during the current settle.
3. Reduce repeated emphasis.
4. Shorten copy or simplify layout before shortening its reading time.

Do not multiply the entire timeline by a speed factor to solve a few long holds. Keep the press, cursor, and arrival feeling intentional. Recheck audio timing after every retime.

## Audio direction and mix

For a brief like the Drip film, a useful starting prompt is:

> Original short instrumental with a punchy groove from the first beat, syncopated bass, tight drums, and a memorable repeating synth hook. Confident, clean product-launch energy. No slow ambient introduction or empty breakdown. Build small lifts around the scene changes and resolve deliberately into the final logo, with a short clean tail.

Add actual duration, desired genre/tempo, and scene-change times from the current storyboard. Do not request a recognizable artist imitation. Keep the prompt and provider/model provenance with the asset; keep credentials out of the project. On a timed-out generation with an unknown outcome, check the provider result before retrying a potentially billable request.

Listen to the returned cue when playback is available. Determine its actual accents and structure, then align picture and foley. A nominal 128 BPM pulse has a beat interval of 60/128 seconds, but a generated file may drift or start off-grid. Do not quantize camera moves blindly to a nominal BPM.

Master for clean sound, not maximum loudness. Around −16 LUFS is a useful starting point for a short web film; respect destination requirements. Keep true peaks below the destination ceiling and leave headroom. Fix masking with track gain, sparse effects, and arrangement before adding a limiter. Confirm audio begins cleanly and ends with the picture. Distinguish measured input loudness from a loudnorm filter's hypothetical output report.

When feedback says “boring music,” evaluate groove, hook, arrangement, and the opening/ending. A louder version of the same sparse cue usually leaves the complaint unresolved.
