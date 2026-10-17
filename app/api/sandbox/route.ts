import { NextRequest, NextResponse } from 'next/server';
import { enterSandbox, leaveSandbox, resetSandbox, seedSandbox, getSandboxStatus } from '@/lib/sandbox';

/**
 * Enter, leave, reset and seed the practice workspace.
 *
 * Every authorisation decision here is made in the database — provision,
 * switch and reset are SECURITY DEFINER functions that validate the caller
 * themselves (migration 032). This route deliberately re-checks nothing: a
 * second copy of the rules in TypeScript is a second copy to drift.
 */
export async function GET() {
  return NextResponse.json(await getSandboxStatus());
}

export async function POST(request: NextRequest) {
  let body: { action?: string; seed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  switch (body.action) {
    case 'enter': {
      const entered = await enterSandbox();
      if (!entered.ok) return NextResponse.json({ error: entered.error }, { status: 400 });

      // Seed on first entry so the workspace is useful immediately. An empty
      // sandbox and a broken one look identical, and someone told to "have a
      // play" will read blank charts as the software not working.
      let seed = null;
      if (body.seed !== false) {
        const status = await getSandboxStatus();
        if (!status.seededAt) seed = await seedSandbox();
      }
      return NextResponse.json({ ok: true, orgId: entered.orgId, seed });
    }

    case 'leave': {
      const left = await leaveSandbox();
      if (!left.ok) return NextResponse.json({ error: left.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case 'reset': {
      // Admin-only, enforced by the database function.
      const reset = await resetSandbox();
      if (!reset.ok) return NextResponse.json({ error: reset.error }, { status: 403 });
      return NextResponse.json({ ok: true, orgId: reset.orgId });
    }

    case 'seed': {
      const seed = await seedSandbox();
      return NextResponse.json({ ok: seed.problems.length === 0, seed });
    }

    default:
      return NextResponse.json(
        { error: 'action must be one of: enter, leave, reset, seed.' },
        { status: 400 },
      );
  }
}
