# Oren showcase screenshots

Captured October 29, 2026, directly from browser content without Windows activation overlay.

01-home.jpg: live oren.finance landing page.
02-markets.jpg: real Oren market components populated with four illustrative equities.
03-nvidia.jpg: real NVIDIA detail, chart, trade ticket and market outlook components with illustrative data.
04-portfolio.jpg: real portfolio components populated with $128,450.68 total, $111,027.80 equities and $17,422.88 cash. Four holdings; no locked assets.

Market prices, indicators, chart histories and balances in the three app screenshots are demo fixtures, not live quotes or actual account performance. No account, database, wallet balance or financial transaction was modified.

preview-source.tsx preserves the temporary local capture fixture. It has been removed from app routes and was not deployed. To recreate locally, copy to app/app/showcase-preview/page.tsx, copy the four token PNGs from oren-launch/assets/tokens to app/public/showcase-assets, run Next dev with webpack, and open /showcase-preview?view=markets, token or portfolio. Remove the temporary route/assets afterward. Avoid deploying this fixture.

Home capture corrected on October 29: recaptured after the gradient rendered fully; verified smooth landscape fade without the original horizontal cutoff.

Header: oren-header-1500x500.png, 1500x500 (3:1), PNG, 1,702,806 bytes. Built-in imagegen; reference: home hero. Final prompt: standalone Oren brand header, sunset alpine lake and wildflowers, peach/lavender sky, smooth cream atmospheric fade, established glowing black mascot, Oren wordmark and existing tagline; no app UI or screenshot framing. Original generated output retained as oren-header.png.

Header revision: oren-header-solana-1500x500.png. Built-in imagegen edit prompt: replace only the tagline with 'AI-powered tokenized stock trading terminal on Solana.'; preserve the established header artwork and 3:1 composition. Exported 1500x500 PNG.
