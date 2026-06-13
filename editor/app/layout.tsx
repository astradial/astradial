import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "../styles/globals.css";

import type { Metadata } from "next";

import { AuthExpiryWatcher } from "@/components/auth/AuthExpiryWatcher";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";

// eslint-disable-next-line react-refresh/only-export-components
export const metadata: Metadata = {
  title: "AstraDial",
  description: "Communications made simple by Astradial",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body
        className="min-h-screen bg-background text-foreground antialiased font-sans"
        cz-shortcut-listen="true"
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AuthExpiryWatcher />
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
