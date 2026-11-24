import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The sections under Products and Parts. Regulation workspaces that build on
 * the product list (EUDR now; CBAM and PPWR as they are built) are added here
 * rather than to the sidebar, so the sidebar stays a short list of jobs.
 */
const SECTIONS = [
  { key: 'products', href: '/products', label: 'Parts and scope' },
  { key: 'eudr', href: '/eudr', label: 'EUDR due diligence' },
] as const;

export type WorkspaceKey = (typeof SECTIONS)[number]['key'];

export function WorkspaceNav({ current }: { current: WorkspaceKey }) {
  return (
    <nav aria-label="Products and Parts sections" className="-mx-4 sm:mx-0 border-b border-gray-200">
      <div className="flex gap-5 overflow-x-auto px-4 sm:px-0 [scrollbar-width:none]">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            aria-current={s.key === current ? 'page' : undefined}
            className={cn(
              'shrink-0 whitespace-nowrap border-b-2 pb-2.5 pt-1 text-sm transition-colors',
              s.key === current
                ? 'border-emerald-600 font-medium text-emerald-700'
                : 'border-transparent text-gray-500 hover:text-gray-900',
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
