import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Coffee++ Booth Console",
  description:
    "Coffee++ staff-side booth console: scan customer Order QRs, run the waiting line, track sales, net profit and reports.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <body
        className={`${fraunces.variable} ${jakarta.variable} antialiased bg-background text-foreground`}
      >
        {/* Apply the staff's saved color palette BEFORE first paint.
            Whitelist mirrors src/lib/palettes.ts; "cozy" is the :root default
            (no attribute needed), so an empty/unset value simply stays cozy. */}
        <Script id="coffeepp-palette-boot" strategy="beforeInteractive">
          {`(function(){try{var p=localStorage.getItem("coffeepp-admin:palette");if(p==="cozy"||p==="midnight-mint"||p==="espresso"||p==="matcha"||p==="golden-hour"||p==="rosewood"||p==="charcoal"||p==="polar-mint"){document.documentElement.setAttribute("data-palette",p)}}catch(e){}})()`}
        </Script>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} enableColorScheme={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
