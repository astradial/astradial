import Link from "next/link";

import AstradialLogo from "@/components/icons/AstradialLogo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { Button } from "@/components/ui/button";

const resources = [
  { label: "Astradial", href: "https://astradial.com" },
  { label: "Wiki", href: "https://wiki.astradial.com" },
  { label: "Status", href: "https://status.astradial.com" },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b bg-background/80 backdrop-blur-lg z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-3">
            <AstradialLogo className="h-6 sm:h-8 w-auto" />
            <h1 className="text-md sm:text-2xl font-semibold">AstraDial</h1>
          </div>
          <ThemeSwitch />
        </div>
      </header>

      <iframe
        src="/editor"
        className="w-dvw h-dvh z-0 absolute inset-0 pointer-events-none opacity-10"
      />

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 text-center backdrop-blur-xs">
          <div className="space-y-4">
            <p className="text-base font-medium uppercase tracking-[0.2em] text-purple-400">
              Communications Made Simple
            </p>
            <p className="text-balance text-3xl font-semibold sm:text-4xl lg:text-5xl">
              Give your customer a SuperHuman Support
            </p>
            <p className="text-balance text-lg text-muted-foreground">
              Astradial Flow Editor is the visual builder for AI voice bots. Design
              conversational flows, configure call transfers, and deploy directly to
              your AstraPBX infrastructure.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="w-full sm:w-auto" asChild>
              <Link href="/dashboard" prefetch>
                Get Started
              </Link>
            </Button>
          </div>
        </div>
      </main>

      <footer className="border-t bg-muted/30 backdrop-blur-lg z-20">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {resources.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noreferrer" : undefined}
                className="transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Built by</span>
            <a
              href="https://astradial.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 font-medium text-foreground"
            >
              <AstradialLogo height={16} color="currentColor" />
              Astradial
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
