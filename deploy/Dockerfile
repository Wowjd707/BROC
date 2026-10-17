# syntax=docker/dockerfile:1
#
# BROC application image.
#
# Debian slim rather than Alpine on purpose: Next's SWC binaries and sharp are
# glibc-native, and musl builds are a recurring source of "works on my machine"
# for people self-hosting. The image is ~60MB larger and that is a fair trade
# for an install that works the first time on someone else's server.

# ── 1. Dependencies ──────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── 2. Build ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js inlines every NEXT_PUBLIC_* value into the client bundle at BUILD
# time, not at run time. They therefore have to be build arguments; setting
# them only in the container's environment leaves the browser with `undefined`
# and an app that renders but cannot reach Supabase. This is the single most
# common self-hosting mistake with Next and it fails silently.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Optional build-time settings: invitation links, white-label branding, and
# which single sign-on buttons the login page shows. All NEXT_PUBLIC_*, so all
# inlined at build time like the two above.
#
# These are NOT set with ENV. An unset build arg would become an empty string,
# and an empty string is a value: the product name would render blank instead
# of falling back to its default. So only the ones actually supplied are
# written to .env.production, which `next build` reads.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_PRODUCT_NAME
ARG NEXT_PUBLIC_PRODUCT_SHORT_NAME
ARG NEXT_PUBLIC_PRODUCT_TAGLINE
ARG NEXT_PUBLIC_PRODUCT_MARK
ARG NEXT_PUBLIC_PRODUCT_MARK_SRC
ARG NEXT_PUBLIC_PRODUCT_WORDMARK_SRC
ARG NEXT_PUBLIC_SSO_PROVIDERS
ARG NEXT_PUBLIC_SSO_SAML
RUN : > .env.production \
 && for v in NEXT_PUBLIC_APP_URL NEXT_PUBLIC_PRODUCT_NAME NEXT_PUBLIC_PRODUCT_SHORT_NAME \
             NEXT_PUBLIC_PRODUCT_TAGLINE NEXT_PUBLIC_PRODUCT_MARK NEXT_PUBLIC_PRODUCT_MARK_SRC \
             NEXT_PUBLIC_PRODUCT_WORDMARK_SRC NEXT_PUBLIC_SSO_PROVIDERS NEXT_PUBLIC_SSO_SAML; do \
      val="$(printenv "$v" || true)"; \
      if [ -n "$val" ]; then printf '%s=%s\n' "$v" "$val" >> .env.production; fi; \
    done \
 && echo "Optional build settings applied:" && cut -d= -f1 .env.production

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. Runtime ───────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs --create-home nextjs

# `output: 'standalone'` in next.config.ts produces .next/standalone, a
# self-contained server with only the modules actually imported. Without that
# setting this COPY fails, which is the intended early warning.
COPY --from=builder            /app/public          ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

USER nextjs
EXPOSE 3000

# Dependency-free health check: Node 22 has global fetch, so there is no need
# to install curl into the runtime image just to answer "are you up".
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
