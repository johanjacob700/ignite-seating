import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ignite Church Newark — Live Seating",
  description: "Real-time seating chart for Ignite Church Newark Sunday services",
};

// PWA-friendly theme color matching Ignite brand crimson
export const viewport: Viewport = {
  themeColor: "#BE1E2D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full bg-zinc-950 text-white" suppressHydrationWarning>{children}</body>
    </html>
  );
}
