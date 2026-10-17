import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default:     'bg-emerald-100 text-emerald-700',
        secondary:   'bg-gray-100 text-gray-700',
        destructive: 'bg-red-100 text-red-700',
        warning:     'bg-amber-100 text-amber-700',
        blue:        'bg-blue-100 text-blue-700',
        purple:      'bg-purple-100 text-purple-700',
        outline:     'border border-gray-300 text-gray-600',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
