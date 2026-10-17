/**
 * Single source of truth for product naming.
 *
 * Every user-visible string resolves from here, so rebranding is a change to
 * this file (or to environment variables) rather than a hunt through the tree.
 * SQL comments and documentation are prose rather than runtime strings; rename
 * those by find-and-replace if you want them to match.
 *
 * Overridable per deployment, so you can white-label without forking. If you
 * are renaming your own fork, this file is the only code you need to change.
 */


/**
 * Choose between supplied artwork, the built-in artwork, and nothing.
 *
 * The rule that matters is the last one: **the built-in artwork belongs to the
 * built-in name.** A fork that sets NEXT_PUBLIC_PRODUCT_NAME to its own name
 * and stops there must not keep rendering BROC's logo beside it — that is a
 * wrong mark shipped silently, and the person who renamed the product is
 * exactly the person who would not think to look for it.
 *
 * So: an explicit path always wins. Absent one, the built-in artwork is used
 * only while the built-in name is. Rename without supplying a logo and the
 * letter tile comes back, which is plain but never wrong.
 *
 * Setting the variable to `none` forces the letter tile even under the original
 * name. A blank value means "not set", the same as leaving it out — template
 * files ship with blank lines, and a blank line must not change anything.
 */
function resolveArtwork(supplied: string | undefined, builtIn: string): string | null {
  const value = supplied?.trim();
  if (value) return value.toLowerCase() === 'none' ? null : value;
  return process.env.NEXT_PUBLIC_PRODUCT_NAME?.trim() ? null : builtIn;
}

/** An environment value, with a blank one treated as unset. */
function envOr(value: string | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback;
}

export const BRANDING = {
  /** Full product name. Used in titles, reports, and email. */
  productName: envOr(process.env.NEXT_PUBLIC_PRODUCT_NAME, 'BROC'),

  /** Short form for tight spaces (sidebar, nav). */
  shortName: envOr(process.env.NEXT_PUBLIC_PRODUCT_SHORT_NAME, 'BROC'),

  /** One-line descriptor beneath the product name. */
  tagline: envOr(process.env.NEXT_PUBLIC_PRODUCT_TAGLINE, 'Self-hosted ESG and sustainability platform'),

  /** Single letter or short mark for the logo tile. Used when no artwork is set. */
  mark: envOr(process.env.NEXT_PUBLIC_PRODUCT_MARK, 'B'),

  /**
   * Square logo for the sidebar tile and the browser tab, or null for the
   * letter tile.
   *
   * The artwork is self-contained — it carries its own background — so a
   * deploying organization can point this at any square logo without also having to find the
   * tile colour in CSS.
   */
  markSrc: resolveArtwork(
    process.env.NEXT_PUBLIC_PRODUCT_MARK_SRC,
    '/brand/broc-mark.svg',
  ),

  /**
   * Horizontal wordmark, or null to set the product name as text.
   *
   * Drawn as geometry rather than set in a typeface, so it needs no font
   * licence and renders identically everywhere. Stroke is currentColor, so
   * whatever renders it decides the colour.
   */
  wordmarkSrc: resolveArtwork(
    process.env.NEXT_PUBLIC_PRODUCT_WORDMARK_SRC,
    '/brand/broc-wordmark.svg',
  ),
} as const;

/** Page title helper: "Dashboard · BROC". */
export function pageTitle(section?: string): string {
  return section ? `${section} · ${BRANDING.productName}` : BRANDING.productName;
}
