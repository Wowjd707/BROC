import { Skeleton, SkeletonCards, SkeletonTable } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <SkeletonCards count={4} />
      <SkeletonTable rows={6} cols={5} />
    </div>
  );
}
