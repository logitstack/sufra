import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap'
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Sufra',
  description: 'Your recipe library, meal planner, and kitchen companion.',
  applicationName: 'Sufra',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Sufra' }
};

export const viewport: Viewport = {
  themeColor: '#5C1A1B',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="bg-paper min-h-screen font-body text-ink">
        {children}
      </body>
    </html>
  );
}
