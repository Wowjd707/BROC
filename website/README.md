# gobroc.com

The public landing page for BROC: one static HTML page, its screenshots and the
favicon. No build step and no framework.

Deployed by a separate Vercel project whose Root Directory is `website/`, with
the framework preset set to "Other". Edit `index.html`, push, and Vercel
redeploys it.

The screenshots in `img/` are copies of `docs/screenshots/` with the app
sidebar cropped off, saved as lossless WebP so small text stays sharp, plus a
JPEG of the dashboard for link previews (`og-dashboard.jpg`). Capture at the
screen's full resolution and without lossy compression: a screenshot saved as
JPEG and then compressed again blurs every label. When the README screenshots
are retaken, refresh these too.
