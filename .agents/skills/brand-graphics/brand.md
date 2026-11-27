# Oren brand

The one guide for Oren's look: the paintings, the colors, the type, the two post templates, and the words on them. Repo agents, designers and anyone prompting an image generator for Oren follow this file.

This file lives at `.agents/skills/brand-graphics/brand.md`, because root `docs/` is local build-board material. How to fill and render a post is in [SKILL.md](SKILL.md).

## The idea

Oren lives in a painted valley at golden hour: a warm sky, grass-green hills, lavender mountains, wildflowers, calm water and a few pines. The paintings carry the color. Everything around them stays calm: warm white, near-black ink, black buttons, and one lavender accent.

This replaces the November 14 style, which used flat ivory, a sage second line and a layout copied from another brand's posts. `references/price-alerts-v2.jpg` shows that older style. Don't match it.

## The world

These paintings in `app/public` are the brand world. They are one place, painted the same way.

| Scene | File | Used on |
| --- | --- | --- |
| Valley | `oren-editorial-landscape-hero.webp` | Landing hero and closing band, token page, roadmap |
| Garden | `agents-coastal-garden-hero.webp` | Agents page |
| Lake | `oren-error-landscape.png` | Error page |
| Glass city | `oren-market-landscape-hero.webp` | Not used yet |

Rules for every scene:

- Golden hour. Peach and gold sky, lavender in the distance, green in the land, soft mist.
- Leave a quiet area of mist or sky for the headline. Text never sits on busy painting.
- Put a pine or cypress in every new scene. Oren is Hebrew for pine, and the valley and lake already have them.
- No people, no text, no logos in the painting. The mascot is added on top from the official SVG, never painted in.

Recipe for a new scene. Copy it as written, then add the one thing that scene needs:

```
Soft painted landscape at golden hour. Peach and gold sky with a few pink clouds. Lavender mountains in the distance, rolling grass-green hills, a few pine trees, wildflowers in the foreground, calm water reflecting the sky. The lower third fades into warm white mist. Gouache texture, gentle light. No people, no text, no logos.
```

Don't name an animation studio or another artist in the prompt. Describe the look instead.

## Color

All values below are tokens in `app/app/styles/theme.css`, with Tailwind utilities such as `bg-valley-mist`, `text-brand-text` and `border-brand-line`.

### From the paintings

Measured from the four paintings: the typical color of each hue family across all their pixels. Use these for art, graphics and marketing surfaces. They are the same in light and dark.

| Name | Token | Hex | Where it shows up |
| --- | --- | --- | --- |
| Mist | `--valley-mist` | `#fefbf5` | Fades, post grounds. Most of every painting. |
| Sky | `--valley-sky` | `#fdcda2` | Sunset sky |
| Sun | `--valley-sun` | `#fdd793` | Light and glow |
| Bloom | `--valley-bloom` | `#f4bfae` | Clouds and flowers |
| Lavender | `--valley-lavender` | `#afa7ca` | Mountains and lavender fields |
| Meadow | `--valley-meadow` | `#8e8a3c` | Grass and hills |
| Pine | `--valley-pine` | `#585d35` | Trees and shade |

### Warm neutrals

For marketing pages and graphics. The landing already uses grounds close to these.

| Name | Token | Hex | Use |
| --- | --- | --- | --- |
| Ground | `--valley-ground` | `#f7f4ef` | Page ground |
| Line | `--valley-line` | `#e5dfd6` | Borders and dividers |
| Muted | `--valley-muted` | `#6f685e` | Second headline lines, labels |
| Ink | `--valley-ink` | `#120f0b` | Text and buttons |

### The accent: Lavender

One accent, from the mountains in the paintings and the violet edge of the mascot.

| Name | Token | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| Brand | `--brand` | `#6e5c9c` | `#b5a8dc` | Focus rings, icons, avatars, small solid marks |
| Brand text | `--brand-text` | `#5d4b89` | `#c7bde7` | Links and accent labels |
| Brand soft | `--brand-soft` | `#f4f1fd` | `#282238` | Badge and agent-note grounds |
| Brand tint | `--brand-tint` | `#e9e4fb` | `#352d49` | Hover, selected rows, glows |
| Brand line | `--brand-line` | `#d3cbef` | `#453c5f` | Badge borders |

`--link`, `--focus`, `--avatar`, `--info-action`, `--accent-lavender` and `--tone-lavender` all point at this scale.

### Color rules

- The paintings carry the color. UI surfaces are white or warm white, with ink text.
- Buttons are black. The accent never fills a large area or a main button.
- The accent marks small things: links, badges, focus rings, selected states, and the agent's notes.
- Green and red in the UI only mean a price went up or down. The grass green lives in the paintings, not on links or buttons.
- Warnings are amber-brown with an icon.
- No sky blue. Other brands in our space use it, and the old Tailwind sky links are gone.

## Type

- Words: **Onest Variable** (`@fontsource-variable/onest`). Tokens `--font-oren-sans`, `--font-sans` and `--font-display` in `app/app/globals.css`.
- Numbers: **Geist Variable** (`--font-money`), with tabular figures for prices and amounts.
- Headlines are medium (500) with tight tracking, about `-0.05em`. The wordmark is semibold with `0.16em` tracking.
- In graphics, the headline's first line is ink and the second line is muted. The body line is regular, in `#474139`.

## Graphics: two post templates

Both are 16:9 at 1600×900. The template is [templates/post.html](templates/post.html), and these renders are the approved look:

- **Scene**, [references/scene-post.jpg](references/scene-post.jpg). For launches and big news. A painting fills the frame, a soft mist on the left holds the text, and the mascot stands on the ground or shore on the right, looking toward the headline.
- **Plain**, [references/plain-post.jpg](references/plain-post.jpg). For everyday updates and tips. Mist ground, a soft lavender glow, and the mascot peeking in from the bottom right.

Every post has the same parts, in the same places:

1. OREN lockup, top left.
2. One accent badge naming the feature, such as "Price alerts".
3. A two-line headline: the statement in ink, the payoff in muted grey.
4. One body line.
5. The mascot.

## Voice and copy

Each graphic has a badge, a two-line headline, and one body line. No more.

- Plain words. Say what the person can do.
- The statement and the payoff are each one short sentence, usually under six words.
- The body is one sentence or two short ones. It names the feature and where to turn it on when that is true.
- Write the words first. Every word in the image must match them exactly.

The approved example:

- Badge: Price alerts
- Statement: Your stock moved.
- Payoff: You'll know.
- Body: Price alerts are open to everyone. Turn them on in Preferences at oren.finance.

Keep out:

- Em dashes. Use a period or a new line.
- Hype. No "revolutionary", "seamless", "unlock", "supercharge", "the future of", or empty praise.
- Real-time or instant claims about alerts, prices or trades.
- Made-up prices, tickers, percentages, times, counts or other numbers.
- Performance or trading promises: no returns, no "you will profit", no "best price", no claims about the safety of funds.
- A fake app screen, a fake chart, or interface copy that isn't in the brief.

## Mascot

The official artwork is the black blob with two pale pill eyes and a cyan-to-violet rim. Use it as drawn.

- Vector, source of truth: `app/public/oren-mark.svg`
- Same drawing: `app/app/icon.svg` and `docs-site/public/oren-logo.svg`
- React component with states and eye movement: `app/components/brand/oren-logo.tsx`
- Raster for tools that need a bitmap: `app/public/oren-email-mark.png` (120×120)

Face `#07070c`. Rim `#38bdf8` to `#f8fbff` to `#a855f7`. Eyes `#eef6ff` with glow `#dbeafe`. These belong to the mascot only. Don't use them as UI colors.

The mascot can look toward the idea by moving its eyes, as the template's `oren-look` does. Don't add a mouth, limbs, teeth, blush or 3D shading. Don't redraw the silhouette or recolor the rim.

## Do

- One idea per graphic, with the mascot looking at it.
- A painting from the world, or warm mist, as the ground.
- Ink statement, muted payoff, one body line, one lavender badge.
- Onest for words, Geist for numbers.
- The official mascot, added on top.
- The OREN lockup, top left.
- Proofread the rendered words against the copy.

## Don't

- Don't put text on a busy part of a painting.
- Don't use sky blue, a full-frame gradient, or dark mode in a post.
- Don't use green or red outside of price moves.
- Don't paint the mascot into a scene or change its colors.
- Don't add a second idea, a second headline, or a row of benefits.
- Don't show made-up numbers, prices or tickers.
- Don't hype, promise performance, or use an em dash.
- Don't borrow another company's name, palette or layout.
