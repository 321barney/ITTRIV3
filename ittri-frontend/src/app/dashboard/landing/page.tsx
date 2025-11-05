// Server component (no "use client")
import { redirect } from 'next/navigation';

export default function StudioRootRedirect() {
  redirect('/dashboard/landing/landing-intro');
}
