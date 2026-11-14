# Oren brand

Social graphics and the words on them. Repo agents and anyone prompting an image generator for Oren follow this file. It records the style Dave approved in the price-alerts graphic, using colors and type that already exist in the app wherever those values exist.

This file lives at `.agents/skills/brand-graphics/brand.md`. Root `docs/` is gitignored local build-board material, so the guide sits with the other agent skills. The image prompt and the review checklist are in [SKILL.md](SKILL.md).

Approved example: [references/price-alerts-v2.jpg](references/price-alerts-v2.jpg) (JPEG, 1200×675, 16:9). That file is the reference to attach. It is not a second layout to collage.

## Voice and copy

Each graphic has three pieces of text, and no more:

1. A statement, near-black, one line.
2. A payoff, sage, one line, directly under the statement.
3. One small grey body line under the payoff.

The approved lines are:

- Statement: Your stock moved.
- Payoff: You'll know.
- Body: Price alerts are open to everyone. Turn them on in Preferences at oren.finance.

Rules for every new line:

- Plain words. Say what the person can do.
- Short enough to read at a glance. The statement and the payoff are each one sentence, usually under six words.
- The body is one sentence or two short sentences. It names the feature and where to turn it on when that is true.
- Write the words first, then generate. The image must render those words exactly.
- Use a normal apostrophe when the copy has one. Do not invent punctuation.

Keep out:

- Em dashes. Use a period or a new line.
- Hype. No "revolutionary", "seamless", "unlock", "supercharge", "the future of", or empty praise.
- Real-time or instant claims. Do not say alerts, prices, or trades are instant, live, or real-time.
- Fake prices, tickers, percentages, times, counts, or other numbers.
- Performance or trading promises. No returns, no "you will profit", no "best price", no safety claims about money.
- A fake full app screen, a fake chart with data, or interface copy that is not on the approved chip list for that graphic.

## One idea per graphic

One graphic, one idea. The mascot is inside that idea. In the approved example, the mascot looks toward a small alert, and a single hairline runs from a toggle to that alert. The line is the idea, not decoration beside a logo.

The small OREN lockup at the bottom left is the only extra mark. It does not count as a second idea. Do not add a second feature, a second headline, or a row of benefits.

## Visual system

Light mode only. Editorial layout: large type on the left, the idea on the right, a lot of empty ivory around both. The approved example is the composition to match in quality. Change the props when the feature changes. Keep the same type, color, whitespace, and mascot.

### Type

The app's sans is **Instrument Sans Variable**.

- Package: `@fontsource-variable/instrument-sans` 5.3.0 in `app/package.json`.
- Loaded in `app/app/layout.tsx` and in `docs-site/app/global.css`.
- Tokens in `app/app/globals.css`: `--font-oren-sans`, `--font-sans`, and `--font-display` all point at `"Instrument Sans Variable"`.
- Product headlines use `font-medium` (weight 500) and tight tracking. The homepage headline in `app/app/styles/landing.css` is `tracking-[-.055em]`. The agents hero in `app/app/styles/agents.css` uses the same tracking. The wordmark is `font-semibold` with `tracking-[0.16em]` in `app/app/page.tsx`.

Social headlines use the same family, set large, lighter than the app's medium headlines. The codebase does not define a 300 weight or a second display family. Ask for Instrument Sans, large, at a light setting, with tight tracking around `-0.05em`. If the tool only has regular, use regular. Do not use medium, semibold, or bold for the two headline lines. Do not name a different family as the brand font.

The body line is the same family at a normal regular weight, much smaller than the headline.

The lockup is the official mascot icon plus `OREN` in small tracked caps: semibold, tracking about `0.16em`, color `#111110`.

### Color

Use the exact hex when this table says the value is in code. Values from the generation prompt that never appear in the theme are marked approximate. Do not mix in the market green (`--positive: #1f9d5a` in `app/app/globals.css`). That green is for up and down in the product, not for this sage.

| Role | Hex | In code? | Where |
| --- | --- | --- | --- |
| Canvas | `#f9f9f7` | Yes | Homepage root in `app/app/page.tsx`. Also `app/app/styles/changelog.css`, `token.css`, `roadmap.css`, and the footer in `app/components/landing/landing-footer.tsx`. |
| Warmer ivory, agents page only | `#fdfcf9` | Yes | `.agents-page` in `app/app/styles/agents.css`. Not the social canvas. |
| Statement ink | `#111110` | Yes | Homepage text in `app/app/page.tsx`. Also changelog and token page text. |
| Theme accent, not the social ink | `#111111` | Yes | `--accent` in `app/app/globals.css`. One step off `#111110`. Social type uses `#111110`. |
| Payoff sage | `#748368` | Yes | `.agents-hero h1 span` in `app/app/styles/agents.css`. This is the sage accent for the second headline line. |
| Body grey | `#76786d` | Yes | `.agents-editorial-copy` in `app/app/styles/agents.css`. |
| Soft lavender | `#e0d7fb` | Yes | `--accent-lavender` in `app/app/globals.css`. The one glow, and the lavender in chips. |
| Chip and pill fill | `#ffffff` | Yes | `--panel` and `--background` in `app/app/globals.css`. |
| Hairline | `#111110` | Yes | Same ink as the statement, drawn as one thin line. There is no separate sparkline token. |
| Mascot face | `#07070c` | Yes | `app/public/oren-mark.svg` and `app/components/brand/oren-logo.tsx`. |
| Rim, cyan end | `#38bdf8` | Yes | Same files. Gradient stop at 0%. |
| Rim, light middle | `#f8fbff` | Yes | Same files. Gradient stop at 48%. |
| Rim, violet end | `#a855f7` | Yes | Same files. Gradient stop at 100%. |
| Eye glow | `#dbeafe` | Yes | Same files. |
| Eye | `#eef6ff` | Yes | Same files. |

Not in the codebase. The prompt that produced the approved graphic asked for these. Treat them as approximate and do not prefer them over the table above:

| Prompt asked for | Nearest exact token | Note |
| --- | --- | --- |
| Canvas `#FAF9F7` | `#f9f9f7` | Prompt value is not in the CSS. |
| Sage `#6C7C60` | `#748368` | Prompt value is not in the CSS. The approved jpeg is a little darker than `#748368`. Match `#748368` for new work so social type and the agents page stay on one sage. |
| Body `#767674` | `#76786d` | Prompt value is not in the CSS. The two are nearly the same. Use `#76786d`. |
| Glow `#D8C4F8` | `#e0d7fb` | Prompt value is not in the CSS. Use `--accent-lavender`. |

The homepage hero's second line is warm grey `#69665f` (`.landing-headline > span` in `app/app/styles/landing.css`). Social payoff lines use the agents sage `#748368`, which is the accent in the approved graphic. Do not recolor the payoff to that grey.

There is no token for the toggle knob's exact saturation. Keep the knob and the bell in the `#e0d7fb` lavender family, soft, and match the approved example. Do not invent a new hex. Do not use the mascot violet `#a855f7` as a chip fill. That color belongs to the rim.

### Ground, glow, and line

- Flat ivory `#f9f9f7`. No paper texture, no gradient wash across the whole frame, no dark mode.
- One soft lavender glow, `#e0d7fb`, low and behind the mascot, easy to miss. A hint of the rim cyan `#38bdf8` may sit inside that same glow. One glow only.
- One hairline in `#111110`. It has to connect the idea (in the example, it runs from the toggle area into the alert pill and ends in a small dot). It is not a chart and it carries no numbers.

### Chips

Small white pills with a soft shadow. Two is enough. In the approved example:

- An alert pill: white, fully rounded, a small lavender bell, the words "Your stock moved".
- A toggle chip: white, a hairline lavender outline, the words "Alert on", and a small switch turned on in soft lavender.

New graphics may change the chip words. Keep them to a few words, with no prices and no tickers. Icons stay simple and single-color. In the product UI, icons are Hugeicons. In a generated graphic, draw a plain bell or a plain switch. Do not invent a second icon family.

### Mascot

The official artwork is the black blob with two pale oval eyes and a cyan-to-violet rim. Use it as drawn.

- Vector, source of truth: `app/public/oren-mark.svg`
- Same drawing: `app/app/icon.svg` and `docs-site/public/oren-logo.svg`
- React component, same paths and colors: `app/components/brand/oren-logo.tsx`
- Raster for tools that need a bitmap: `app/public/oren-email-mark.png` (120×120)

`app/public/oren-logo.png` is named by `app/scripts/validate-oren-logo.mjs` and is not in the repo. Do not ask a tool to attach it.

The mascot belongs in the concept. It looks at, holds, or is connected to the one idea. It is not a sticker parked next to the headline, and it is not a second copy filling the corner (the lockup is the small one). Do not add a mouth, limbs, teeth, blush, or 3D shading. Do not redraw the silhouette. Do not change the rim colors.

### Lockup

Bottom left. Small mascot icon, then `OREN` in tracked caps, ink `#111110`. Nothing else in the footer. No URL in the lockup. A URL belongs in the body line only when the copy needs it, as in the approved example.

## Sizes

Landscape 16:9 for X.

- 1600×900
- 1672×941

Both are 16:9. Deliver one of those. The approved reference file itself is 1200×675, which is the same ratio, and is for attachment, not the export size.

## Do

- One idea, with the mascot inside it.
- Two headline lines: `#111110` statement, `#748368` payoff. One grey body line in `#76786d`.
- Instrument Sans Variable, large and light for the headline, regular for the body.
- Ivory `#f9f9f7`, one lavender glow, one hairline, generous whitespace.
- One or two small white chips.
- Official mascot colors and silhouette.
- Small OREN lockup, bottom left only.
- Proofread the rendered words against the copy you supplied.

## Don't

- Don't put more than one idea in the frame.
- Don't paste the mascot beside the text as a logo with a caption.
- Don't add a mouth, limbs, or 3D shading, and don't recolor the rim.
- Don't use dark mode, scenery, a cinematic look, grain, or a full-frame gradient.
- Don't show a fake app, a dense card, a ticker, a price, a percentage, a time, or any other made-up number.
- Don't promise performance, safety of funds, or instant or real-time behavior.
- Don't hype, and don't use an em dash.
- Don't add text that was not in the copy.
- Don't borrow another company's name, palette, or layout.
- Don't set the headline in bold.
