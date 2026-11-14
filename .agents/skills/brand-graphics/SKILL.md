---
name: brand-graphics
description: Write Oren social graphics and the image-generation prompt for them. Use for an X or other social image, a brand graphic, or a Codex imagegen prompt in the approved Oren style. Follow brand.md. Not for product UI, changelog entries, or launch films.
---

# Brand graphics

Read [brand.md](brand.md) before writing copy or prompting an image. That file is the style guide: voice, exact colors, Instrument Sans Variable, the mascot paths, and the one-idea rule. This file is the prompt and the review.

The approved example is [references/price-alerts-v2.jpg](references/price-alerts-v2.jpg). Attach it for quality and layout. Do not reuse its words unless the graphic is that same announcement.

## What to attach

Attach both of these every time:

1. Official mascot bitmap: `app/public/oren-email-mark.png`. If the tool can take SVG, also attach `app/public/oren-mark.svg`. That SVG is the source of truth for the silhouette and the rim. The PNG is 120×120. Do not attach `app/public/oren-logo.png`. It is not in the repo.
2. Approved example: `.agents/skills/brand-graphics/references/price-alerts-v2.jpg`.

Tell the tool the mascot is a black rounded blob, two pale oval eyes, rim from `#38bdf8` through `#f8fbff` to `#a855f7`, face `#07070c`, eyes `#eef6ff` with glow `#dbeafe`. Keep it exactly as drawn. No mouth, no limbs, no 3D shading.

## Fill-in prompt

Replace the bracketed lines. Leave every other word as written. The headline, payoff, and body must already follow the voice rules in brand.md.

```
Use your image generation tool to create ONE social graphic for OREN (Oren Finance). Save a 16:9 landscape, 1600x900 (1672x941 is also fine).

Attached references:
- The official OREN mascot: a black rounded blob with two pale oval eyes and a cyan-to-violet rim. Face #07070c. Rim #38bdf8, then #f8fbff, then #a855f7. Eyes #eef6ff with glow #dbeafe. Keep it exactly as drawn. Do not add a mouth, limbs, or 3D shading.
- The approved Oren social example. Match its quality and art direction: large light Instrument Sans, a two-line headline, generous whitespace, one soft glow, small white chips, one thin line tying the idea together, a quiet editorial feel. The mascot is part of the idea. Do not copy the example's words, chips, or props unless this brief uses them.

Composition (one visual idea, and the mascot is part of that idea):
- Warm ivory background #f9f9f7, flat and clean, light mode only. One soft lavender glow (#e0d7fb) low behind the mascot, very subtle, with a hint of cyan (#38bdf8). No second glow.
- Right side: the OREN mascot at a medium size, inside this idea: [CONCEPT AND PROPS]. One thin hairline in #111110 connects the idea and ends cleanly. Chips, if any, are tiny white pills with a soft shadow and a little lavender (#e0d7fb). Chip text, if any: [CHIP LINES]. No tickers, prices, numbers, percentages, or times.
- Left side: a large headline in Instrument Sans, light weight if available, otherwise regular, not medium and not bold, tight tracking, on two lines:
  Line 1 in #111110: "[HEADLINE]"
  Line 2 in sage #748368: "[PAYOFF]"
  Under that, one small regular grey line in #76786d: "[BODY]"
- Bottom left: a small OREN lockup, the mascot icon plus "OREN" in small tracked caps, ink #111110.

Strict limits: no dark mode, no cinematic or 3D look, no scenery, no dense cards, no full app screens, no extra text, no misspellings, no em dashes, no hype, no real-time or instant claims, no performance or trading promises, no fake prices or numbers. Render the headline, payoff, body, and chip lines exactly as written.
```

Worked fill, already approved. Use it only when regenerating this announcement:

- Headline: Your stock moved.
- Payoff: You'll know.
- Body: Price alerts are open to everyone. Turn them on in Preferences at oren.finance.
- Concept and props: The mascot looks at a small floating white alert pill above and to its left. The hairline wanders gently across the space and ends in a dot on that pill. The pill has a small lavender bell and the words "Your stock moved". Near the start of the line, a tiny white chip reads "Alert on" beside a lavender toggle switched on.
- Chip lines: "Your stock moved" and "Alert on".

## Before you hand a draft to Dave

Check the image, not the prompt.

- One idea. The mascot is in that idea, not floating as a separate logo.
- The only headline is the two supplied lines. Statement is near-black. Payoff is sage. One grey body line. No extra sentence.
- Rendered text matches the brief, including apostrophes and oren.finance when it is in the copy.
- No em dash, no hype, no "instant" or "real-time", no profit or performance claim.
- No price, ticker, percentage, time, or other number.
- No full app, no dense card, no scenery, no dark background, no 3D mascot.
- Mascot matches the official art: two oval eyes, no mouth, no limbs, cyan-to-violet rim, black face.
- One soft lavender glow. Ivory ground. One hairline. Lockup only at the bottom left, reading OREN.
- Frame is 16:9, at 1600×900 or 1672×941.
- It does not imitate another brand. The references are the Oren mascot and the Oren example only.

If any line fails, regenerate. Do not send the draft with a note that the type is "close enough".
