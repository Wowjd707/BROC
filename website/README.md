# gobroc.com

The public site for BROC: five static HTML pages (`index`, `features`,
`approach`, `start`, `help`) sharing one stylesheet (`site.css`), plus the
screenshots and favicon. No build step and no framework. Each page carries the
same header, so a new page needs adding to the nav on every page, and the
Previous and Next buttons at the bottom follow the nav order.

`vercel.json` turns on clean URLs, so `gobroc.com/features` serves
`features.html`.

Deployed by a separate Vercel project whose Root Directory is `website/`, with
the framework preset set to "Other". Edit `index.html`, push, and Vercel
redeploys it.

The screenshots in `img/` are copies of `docs/screenshots/` with the app
sidebar cropped off, saved as lossless WebP so small text stays sharp, plus a
JPEG of the dashboard for link previews (`og-dashboard.jpg`). Capture at the
screen's full resolution and without lossy compression: a screenshot saved as
JPEG and then compressed again blurs every label. When the README screenshots
are retaken, refresh these too.
