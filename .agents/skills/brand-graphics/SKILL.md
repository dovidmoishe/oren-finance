---
name: brand-graphics
description: Make Oren social graphics in the approved Valley style, and write image prompts for new painted scenes. Use for an X or other social image, a brand graphic, or a Codex imagegen prompt for Oren. Follow brand.md. Not for product UI, changelog entries, or launch films.
---

# Brand graphics

Read [brand.md](brand.md) before writing copy or making an image. It has the world, the colors, the type, the two post templates and the voice rules. This file covers how to make a post and how to check it.

Approved looks:

- Scene post: [references/scene-post.jpg](references/scene-post.jpg)
- Plain post: [references/plain-post.jpg](references/plain-post.jpg)

`references/price-alerts-v2.jpg` is the older style. Don't attach it or match it.

## Make a post from the template

Posts are built from [templates/post.html](templates/post.html), not generated whole by an image model. That keeps the words exact and the mascot official.

1. Write the copy first: badge, statement, payoff, body. It must follow the voice rules in brand.md.
2. Pick the template by setting `data-template` on `.frame`:
   - `scene` for launches and big news, with a painting behind.
   - `plain` for everyday updates and tips, on warm mist.
3. Replace the badge text, the headline, the second line inside the headline's `<span>`, and the body line. Change nothing else.
4. For a scene post, keep the default valley painting or point `--scene` at another painting in `app/public`. Adjust `--scene-position` so the mist area sits behind the text.
5. Open the file in a browser with a 1600×900 viewport and screenshot the `.frame` element. Any headless browser works. Wait for fonts to load first, because Onest comes from Google Fonts.
6. Export JPEG or PNG at 1600×900.

The badge icon is a Lucide icon drawn inline. To change it, paste another Lucide icon's paths into the badge `<svg>`.

## Make a new painted scene

Use this only when a post or page needs a new place in the world. Start from the recipe in brand.md and add the one thing that scene needs.

```
Use your image generation tool to create ONE landscape painting for OREN. 16:9, at least 1672x941.

[RECIPE FROM brand.md]

This scene: [WHAT IS IN IT, for example "a small wooden bridge over a stream" or "a path up to a hilltop with a view of the valley"].

Keep the lower third or the left side calm, fading into warm white mist, so text can sit there. Include at least one pine or cypress. No people, no text, no logos, no characters.
```

Attach `app/public/oren-editorial-landscape-hero.webp` as the style reference. Never ask the model to paint the mascot. It is added on top from the SVG.

## Before you hand a draft to Dave

Check the image, not the prompt.

- One idea. The mascot looks toward the headline.
- The words match the brief exactly, including apostrophes and oren.finance.
- Statement in ink, payoff in muted grey, one body line, one lavender badge.
- Text sits on mist or sky, not on busy painting.
- The mascot is the official art: two pill eyes, no mouth, no limbs, cyan-to-violet rim, black face.
- No sky blue. No green or red outside of price moves.
- No em dash, no hype, no "instant" or "real-time", no profit or performance claim.
- No price, ticker, percentage, time, or other made-up number.
- OREN lockup at the top left.
- 16:9 at 1600×900.
- It doesn't imitate another brand.

If any line fails, fix it and render again.
