import { redirect } from 'next/navigation';

/** EUDR moved under Products and Parts; old links and bookmarks land there. */
export default function EudrRedirect() {
  redirect('/products/eudr');
}
