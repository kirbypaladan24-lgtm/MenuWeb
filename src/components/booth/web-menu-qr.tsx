"use client";

// Customer web-menu QR — sits to the LEFT of the scanner on the Scanner
// view (the pair is centered together; stacked below the scanner on small
// screens — see scanner.tsx). The staff sets the deployed client-site link
// in Settings (Booth Details → Customer Web Menu URL); until then a
// clearly-marked PLACEHOLDER QR is shown so the slot is always visible.
// Customers scan it with their phone camera → the web menu opens → they
// order there and come back with their Order QR for this same scanner.
// "Print QR" prints ONLY the poster area — see @media print in globals.css.

import * as React from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Printer, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { BoothInfo } from "@/lib/types";

/** Encoded into the QR until the staff sets the real client-site URL. */
const PLACEHOLDER_URL = "https://coffeepp.example";

export function WebMenuQR() {
  const { toast } = useToast();
  const { data } = useQuery({
    queryKey: ["booth", "settings"],
    queryFn: () => apiFetch<BoothInfo>("/api/booth"),
  });

  const liveUrl = (data?.settings.clientSiteUrl ?? "").trim();
  const isLive = liveUrl !== "";
  const encodedUrl = isLive ? liveUrl : PLACEHOLDER_URL;
  const boothName = data?.settings.boothName ?? "Coffee++";

  const [qrSrc, setQrSrc] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(encodedUrl, {
      width: 512,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#2E1A0EFF", light: "#FFFFFFFF" },
    })
      .then((src) => {
        if (!cancelled) setQrSrc(src);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [encodedUrl]);

  async function handleCopy() {
    if (!isLive) return;
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      toast({ title: "✓ Link copied", description: liveUrl });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the link text below the QR and copy it manually.",
        variant: "destructive",
      });
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Smartphone className="h-4 w-4" aria-hidden />
          </span>
          Order on your phone
        </CardTitle>
        <CardDescription>
          Scan this with a phone camera to open the web menu — customers place
          their order there and show the Order QR back at this scanner.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        {/* Printable poster — the ONLY part that shows on paper.
            Uses fixed poster-ink tokens (NOT theme tokens): this surface is
            white in every palette and literally paper when printed, so
            theme-flipping text (light ink under dark palettes) would turn
            invisible here. */}
        <div className="print-qr-area flex flex-col items-center gap-2 rounded-xl border border-poster-line bg-white p-4">
          <p className="font-display text-lg font-bold leading-tight text-poster-ink">
            {boothName}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-poster-ink-soft">
            Scan for the menu &amp; to order
          </p>
          {qrSrc ? (
            <Image
              src={qrSrc}
              alt={`QR code linking to the ${boothName} web menu`}
              width={512}
              height={512}
              className="h-44 w-44 sm:h-48 sm:w-48"
              unoptimized
            />
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-lg border-2 border-dashed border-poster-line text-xs text-poster-ink-soft sm:h-48 sm:w-48">
              Generating QR…
            </div>
          )}
          <p className="max-w-full break-all text-center font-mono text-[10px] font-semibold leading-relaxed text-poster-ink-soft">
            {encodedUrl}
          </p>
          {!isLive && (
            <p className="rounded-md bg-poster-note/25 px-2.5 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-poster-note-ink">
              Placeholder — set the real link in Settings
            </p>
          )}
        </div>

        <div className="no-print flex w-full flex-col items-center gap-2">
          {isLive ? (
            <div className="flex w-full gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 flex-1 font-semibold"
                onClick={() => void handleCopy()}
              >
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
                {copied ? "Copied" : "Copy Link"}
              </Button>
              <Button
                type="button"
                className="h-10 flex-1 font-semibold"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4" aria-hidden />
                Print QR
              </Button>
            </div>
          ) : (
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              Paste the deployed client site link in{" "}
              <strong>Settings → Booth Details → Customer Web Menu URL</strong>{" "}
              — the QR here updates instantly.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
