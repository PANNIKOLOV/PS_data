import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import { ThemeScript } from '@/components/layout/theme-script';

import './globals.css';

// Self-hosted by Next at build time: no render-blocking request to Google, and
// the fallback metrics are matched to avoid layout shift.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'PS Data — PrestaShop analytics',
    template: '%s · PS Data',
  },
  description:
    'Order and customer analytics across multiple PrestaShop stores, with per-shop access control.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1c21' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${inter.variable} min-h-dvh`}>{children}</body>
    </html>
  );
}
