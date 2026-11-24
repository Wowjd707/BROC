import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

/** "Products and Parts › EUDR": the way back from a regulation dashboard. */
export function Breadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-gray-500">
      <Link href="/products" className="hover:text-gray-900">Products and Parts</Link>
      <ChevronRight size={14} className="text-gray-300" />
      <span className="text-gray-900" aria-current="page">{current}</span>
    </nav>
  );
}
