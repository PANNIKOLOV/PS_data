import { redirect } from 'next/navigation';

/** The application has no public landing page; everything lives behind sign-in. */
export default function RootPage() {
  redirect('/dashboard');
}
