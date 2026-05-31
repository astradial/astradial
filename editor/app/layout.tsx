import { Inter } from "next/font/google";

import "../styles/globals.css";

import type { Metadata } from "next";

import { AuthExpiryWatcher } from "@/components/auth/AuthExpiryWatcher";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

// eslint-disable-next-line react-refresh/only-export-components
export const metadata: Metadata = {
  title: "AstraDial",
  description: "Communications made simple by Astradial",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className={`min-h-screen bg-background text-foreground antialiased ${inter.variable} font-sans`} cz-shortcut-listen="true">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthExpiryWatcher />
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
