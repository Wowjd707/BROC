'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ScopePicker } from './ScopePicker';
import { ProfileDialog } from './ProfileDialog';
import { cn } from '@/lib/utils';
import { BRANDING } from '@/lib/branding';
import { activeOrg } from '@/lib/active-org';
import {
  LayoutDashboard, FileText, BarChart3, Target,
  Wrench, Handshake, ClipboardList, Settings,
  ChevronDown, LogOut, Menu, Network, BookCheck, Grid2x2,
  Users, Scale, Gauge, UserPen,
} from 'lucide-react';

// ─── Nav items ───────────────────────────────────────────────────────────────

/**
 * Navigation, grouped by what the user is trying to DO rather than by module.
 *
 * It was a flat list of ten. Adding social/governance and the regulatory
 * tracker would have made it twelve, at which point a flat list stops being a
 * menu and becomes an inventory - the user reads every item every time because
 * nothing tells them where to stop looking.
 *
 * The grouping also fixes something the flat list quietly got wrong: it
 * presented data collection, target management and external reporting as one
 * undifferentiated pile, when they are three different jobs, usually done at
 * three different times, often by different people.
 *
 * "Reference" is deliberately last and deliberately separate: it is the only
 * section holding no data belonging to your organization.
 */
const NAV_SECTIONS: {
  heading: string | null;
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    heading: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    heading: 'Measure',
    items: [
      { href: '/data',      label: 'Environmental Data Entry', icon: FileText },
      { href: '/scope3',    label: 'Scope 3',              icon: Network },
      { href: '/social',    label: 'Social & Governance',  icon: Users },
      { href: '/metrics',   label: 'Business Metrics',     icon: Gauge },
      { href: '/suppliers', label: 'Suppliers',            icon: Handshake },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { href: '/kpis',     label: 'KPIs',     icon: BarChart3 },
      { href: '/goals',    label: 'Goals',    icon: Target },
      { href: '/projects', label: 'Projects', icon: Wrench },
    ],
  },
  {
    heading: 'Report',
    items: [
      { href: '/materiality', label: 'Materiality',  icon: Grid2x2 },
      { href: '/disclosures', label: 'Disclosures',  icon: BookCheck },
      { href: '/reports',     label: 'Reports',      icon: ClipboardList },
    ],
  },
  {
    heading: 'Reference',
    items: [
      { href: '/regulations', label: 'Regulatory tracker', icon: Scale },
    ],
  },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface Site {
  id: string;
  name: string;
  site_type: string;
  city: string | null;
  state: string | null;
}

interface UserProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
  organizations: {
    id: string;
    name: string;
    reporting_year_start: number;
  } | null;
  /** Set only while the session is pointed at the practice workspace. */
  active_organization?: {
    id: string;
    name: string;
    reporting_year_start: number;
  } | null;
}

interface BusinessUnitOption { id: string; parent_id: string | null; name: string; sort_order?: number; }
interface SiteGroupOption { id: string; name: string; }

interface SidebarLayoutProps {
  children: React.ReactNode;
  userProfile: UserProfile | null;
  sites: Site[];
  businessUnits: BusinessUnitOption[];
  siteGroups: SiteGroupOption[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SidebarLayout({ children, userProfile, sites, businessUnits, siteGroups }: SidebarLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Names the workspace the sidebar's data actually came from, so a practice
  // session is not labelled with the live organization's name.
  //
  // The fallback does not invent a name. organizations.name is NOT NULL and the
  // signup route refuses a blank one, so there is no such thing as an
  // organization without a name — if nothing arrives here, the profile or the
  // embed failed to resolve, and that is a fault rather than a nameless
  // organization. "My Organization" read as a real, if generic, name and made a
  // broken read look like a working one, which is the same way a sandbox whose
  // every seeded row had been refused looked merely empty.
  const orgName = activeOrg(userProfile)?.name ?? 'Organization unavailable';
  const userName = [userProfile?.first_name, userProfile?.last_name].filter(Boolean).join(' ')
    || userProfile?.email
    || 'User';

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const sidebar = (
    <div className="flex flex-col h-full">
      {/* Logo + Org */}
      <div className="px-4 py-5 border-b border-gray-200">
        <div className="flex items-center gap-3">
          {/* The artwork carries its own background, so it replaces the tile
              rather than sitting inside it. Falls back to the letter when a
              deployment has supplied no logo of its own. */}
          {BRANDING.markSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element --
               next/image does not optimise SVG and would add a loader for a
               file measured in hundreds of bytes. A plain img is correct here. */
            <img
              src={BRANDING.markSrc}
              alt=""
              width={32}
              height={32}
              className="w-8 h-8 rounded-lg flex-shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">{BRANDING.mark}</span>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{orgName}</p>
            <p className="text-xs text-gray-400">{BRANDING.shortName}</p>
          </div>
        </div>

        {/* Reporting scope — writes to the URL so server components can filter */}
        <ScopePicker sites={sites} units={businessUnits} groups={siteGroups} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {NAV_SECTIONS.map((section, sectionIdx) => (
          <div key={section.heading ?? `section-${sectionIdx}`} className={cn(sectionIdx > 0 && 'mt-5')}>
            {section.heading && (
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {section.heading}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href || pathname.startsWith(href + '/');
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                      isActive
                        ? 'bg-emerald-50 text-emerald-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                    )}
                  >
                    <Icon size={16} className="flex-shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        <div className="mt-5" />

        <div className="border-t border-gray-200 my-2" />

        <Link
          href="/settings"
          onClick={() => setMobileOpen(false)}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
            pathname.startsWith('/settings')
              ? 'bg-emerald-50 text-emerald-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
          )}
        >
          <Settings size={16} className="flex-shrink-0" />
          Settings
        </Link>
      </nav>

      {/* User menu */}
      <div className="border-t border-gray-200 p-3 relative">
        <button
          onClick={() => setUserDropdownOpen(!userDropdownOpen)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-semibold text-xs flex-shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{userName}</p>
            <p className="text-xs text-gray-400 capitalize">{userProfile?.role}</p>
          </div>
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        </button>

        {userDropdownOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            {userProfile && (
              <button
                onClick={() => { setUserDropdownOpen(false); setMobileOpen(false); setProfileOpen(true); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <UserPen size={14} />
                Edit profile
              </button>
            )}
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
        {/* Desktop sidebar */}
        {/* w-64 (not w-60) so the longest label, "Environmental Data Entry",
            stays on one line — and matches the mobile drawer's width. */}
        <aside className="hidden md:flex w-64 flex-col bg-white border-r border-gray-200 flex-shrink-0">
          {sidebar}
        </aside>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-gray-900/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col">
              {sidebar}
            </aside>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile header */}
          <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Menu size={20} className="text-gray-600" />
            </button>
            <span className="font-semibold text-gray-900">{orgName}</span>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>

        {userProfile && (
          <ProfileDialog
            // Remount on open so the fields start from the saved name.
            key={profileOpen ? 'open' : 'closed'}
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
            userId={userProfile.id}
            email={userProfile.email}
            firstName={userProfile.first_name}
            lastName={userProfile.last_name}
          />
        )}
    </div>
  );
}
