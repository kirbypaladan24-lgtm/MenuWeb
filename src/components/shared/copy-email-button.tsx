"use client";

// CopyEmailButton — tiny icon button that copies one email address to the
// clipboard. Used wherever the console shows a customer email (product
// buyers table, orders view, waiting line, scanner result, serve
// confirmation) so staff can grab an address for receipts / GCash
// confirmations without selecting text by hand.
//
// Clipboard strategy: navigator.clipboard when available (secure context),
// with a hidden-textarea document.execCommand fallback for older browsers
// and non-secure pages.

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or clipboard unavailable — fall through to legacy.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyEmailButton({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  React.useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    []
  );

  async function handleCopy(event: React.MouseEvent) {
    // Never let the click bubble into surrounding links/rows/dialogs.
    event.preventDefault();
    event.stopPropagation();
    const ok = await copyToClipboard(email);
    if (ok) {
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1800);
      toast({
        title: "✓ Email copied",
        description: email,
      });
    } else {
      toast({
        title: "Couldn't copy automatically",
        description: `Select it manually: ${email}`,
        variant: "destructive",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-6 shrink-0 p-0 text-muted-foreground hover:bg-accent hover:text-foreground",
        copied && "text-primary",
        className
      )}
      onClick={handleCopy}
      aria-label={`Copy email address ${email} to clipboard`}
      title="Copy email address"
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      <span className="sr-only">
        {copied ? "Copied to clipboard" : "Copy to clipboard"}
      </span>
    </Button>
  );
}
