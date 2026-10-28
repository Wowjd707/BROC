import { BRANDING } from '@/lib/branding';
import { cn } from '@/lib/utils';

const BUILT_IN_WORDMARK = '/brand/broc-wordmark.svg';

/**
 * The product wordmark, sized by the caller (set a height; width follows).
 *
 * The built-in BROC wordmark is drawn inline rather than as an <img>, because
 * its stroke is `currentColor`: inside an <img> an SVG cannot see the page's
 * colour and renders black whatever class it is given. Inline, it takes the
 * text colour of wherever it sits. The geometry is the same as
 * public/brand/broc-wordmark.svg — keep the two in step.
 *
 * A deployment's own wordmark (NEXT_PUBLIC_PRODUCT_WORDMARK_SRC) renders as an
 * image, in its own colours. With no wordmark at all, the product name is set
 * as text, so a renamed fork never shows BROC's artwork.
 */
export function BrandWordmark({ className }: { className?: string }) {
  const src = BRANDING.wordmarkSrc;

  if (src === BUILT_IN_WORDMARK) {
    return (
      <svg
        viewBox="0 0 392 140"
        role="img"
        aria-label={BRANDING.productName}
        className={cn('w-auto', className)}
      >
        <title>{BRANDING.productName}</title>
        <g fill="none" stroke="currentColor" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round">
          <path d="M7,20 L7,120" />
          <path d="M7,20 A52,25 0 0,1 7,70" />
          <path d="M7,70 A52,25 0 0,1 7,120" />
          <path d="M86,20 L86,120" />
          <path d="M86,20 A52,25 0 0,1 86,70" />
          <path d="M86,70 L141,120" />
          <path d="M179,70 a43,43 0 1,0 86,0 a43,43 0 1,0 -86,0" />
          <path d="M373.6,37.1 A43,43 0 1,0 373.6,102.9" />
        </g>
      </svg>
    );
  }

  if (src) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element --
         next/image does not optimise SVG and would add a loader for a file
         measured in hundreds of bytes. A plain img is correct here. */
      <img src={src} alt={BRANDING.productName} className={cn('w-auto', className)} />
    );
  }

  return <span className={cn('font-bold tracking-tight leading-none', className)}>{BRANDING.productName}</span>;
}
