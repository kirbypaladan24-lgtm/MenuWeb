"use client";

// Settings — booth schedule, payment channel numbers, and console look & feel.
// ADMIN can edit + save (PATCH /api/booth); STAFF sees a read-only view.
// The color palette card is a local per-device preference — always available.

import * as React from "react";
import { format, parseISO } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileJson, Info, Loader2, Palette, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { BoothInfo, BoothState } from "@/lib/types";
import { BOOTH_QK, useApiError } from "./booth-utils";
import { PalettePicker } from "./palette-picker";
import { ViewHeader } from "./view-header";

const STATE_STYLES: Record<BoothState, { label: string; className: string }> = {
  BEFORE: {
    label: "BEFORE",
    className: "bg-secondary text-secondary-foreground border-transparent",
  },
  OPEN: {
    label: "OPEN",
    className: "bg-success/15 text-success border-success/40",
  },
  CLOSED: {
    label: "CLOSED",
    className: "bg-destructive/10 text-destructive border-destructive/40",
  },
};

function isoToLocalInput(iso: string): string {
  try {
    return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}

function localInputToIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** Download a file endpoint as a blob (same pattern as reports). */
async function downloadMenuFile(): Promise<void> {
  const res = await fetch("/api/menu-export");
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body: unknown = await res.json();
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as Record<string, unknown>).error === "string"
      ) {
        message = (body as { error: string }).error;
      }
    } catch {
      // Non-JSON error body — keep the status message.
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="?([^";]+)"?/i.exec(cd);
  a.download = m ? m[1] : "coffeepp-menu.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface SettingsForm {
  boothName: string;
  startDate: string;
  endDate: string;
  gcashNumber: string;
  specsNumber: string;
  contactEmail: string;
  clientSiteUrl: string;
}

function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SettingsView() {
  // No sign-in: the console runs on the booth laptop and always has full access.
  const isAdmin = true;
  const { toast } = useToast();
  const apiError = useApiError();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["booth", "settings"],
    queryFn: () => apiFetch<BoothInfo>("/api/booth"),
  });

  const [form, setForm] = React.useState<SettingsForm | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    if (data?.settings) {
      setForm({
        boothName: data.settings.boothName ?? "",
        startDate: isoToLocalInput(data.settings.startDate),
        endDate: isoToLocalInput(data.settings.endDate),
        gcashNumber: data.settings.gcashNumber ?? "",
        specsNumber: data.settings.specsNumber ?? "",
        contactEmail: data.settings.contactEmail ?? "",
        clientSiteUrl: data.settings.clientSiteUrl ?? "",
      });
    }
  }, [data]);

  function set<K extends keyof SettingsForm>(key: K, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function handleSave() {
    if (!form) return;
    const boothName = form.boothName.trim();
    if (!boothName) {
      toast({
        title: "Check the form",
        description: "Booth name is required.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/api/booth", {
        method: "PATCH",
        json: {
          boothName,
          startDate: localInputToIso(form.startDate),
          endDate: localInputToIso(form.endDate),
          gcashNumber: form.gcashNumber.trim(),
          specsNumber: form.specsNumber.trim(),
          contactEmail: form.contactEmail.trim(),
          clientSiteUrl: form.clientSiteUrl.trim(),
        },
      });
      toast({ title: "✓ Settings saved", description: "Booth settings updated." });
      await queryClient.invalidateQueries({ queryKey: BOOTH_QK });
    } catch (err) {
      apiError(err, "Could not save the settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExportMenu() {
    setExporting(true);
    try {
      await downloadMenuFile();
      toast({
        title: "✓ Menu exported",
        description:
          "coffeepp-menu.json downloaded — drop it into the client project.",
      });
    } catch (err) {
      apiError(err, "Could not export the menu file.");
    } finally {
      setExporting(false);
    }
  }

  const state = data?.state;
  const stateStyle = state ? STATE_STYLES[state] : null;

  return (
    <div>
      <ViewHeader
        title="Settings"
        description="Booth schedule, payment channels, and console appearance."
        action={
          stateStyle ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${stateStyle.className}`}
            >
              {stateStyle.label}
            </span>
          ) : undefined
        }
      />

      {/* Look & feel — per-device color palette (no API dependency) */}
      <Card className="mb-4 gap-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Palette className="h-5 w-5" aria-hidden />
            </span>
            Color palette
          </CardTitle>
          <CardDescription>
            Give the console a mood that fits your shift — cozy is the default.
            Saved on this device, so every staff member can pick their own; the
            customer site always stays Coffee++ warm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PalettePicker />
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : isError || !data || !form ? (
        <Card className="gap-4">
          <CardContent className="py-8">
            <p className="text-center text-sm text-muted-foreground">
              Couldn&apos;t load booth settings.
            </p>
          </CardContent>
          <div className="px-6 pb-2">
            <Button variant="outline" onClick={() => void refetch()}>
              Try Again
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>Booth Details</CardTitle>
              <CardDescription>
                {isAdmin
                  ? "Changes apply immediately — the booth state is computed from the schedule."
                  : "Read-only — admin access is required to change these."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Booth Name" htmlFor="settings-booth-name">
                <Input
                  id="settings-booth-name"
                  value={form.boothName}
                  onChange={(e) => set("boothName", e.target.value)}
                  disabled={!isAdmin || saving}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start" htmlFor="settings-start" hint="Orders open at this time.">
                  <Input
                    id="settings-start"
                    type="datetime-local"
                    value={form.startDate}
                    onChange={(e) => set("startDate", e.target.value)}
                    disabled={!isAdmin || saving}
                  />
                </Field>
                <Field label="End" htmlFor="settings-end" hint="Orders close at this time.">
                  <Input
                    id="settings-end"
                    type="datetime-local"
                    value={form.endDate}
                    onChange={(e) => set("endDate", e.target.value)}
                    disabled={!isAdmin || saving}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="GCash Number"
                  htmlFor="settings-gcash"
                  hint="Shown to customers paying via GCash."
                >
                  <Input
                    id="settings-gcash"
                    value={form.gcashNumber}
                    onChange={(e) => set("gcashNumber", e.target.value)}
                    placeholder="0917 123 4567"
                    disabled={!isAdmin || saving}
                  />
                </Field>
                <Field
                  label="SPECS Number"
                  htmlFor="settings-specs"
                  hint="Campus payment channel shown at checkout."
                >
                  <Input
                    id="settings-specs"
                    value={form.specsNumber}
                    onChange={(e) => set("specsNumber", e.target.value)}
                    placeholder="0918 765 4321"
                    disabled={!isAdmin || saving}
                  />
                </Field>
              </div>

              <Field
                label="Contact Email"
                htmlFor="settings-email"
                hint="Shown on the client site's contact card — leave empty to hide it."
              >
                <Input
                  id="settings-email"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  placeholder="parsu.specs@gmail.com"
                  disabled={!isAdmin || saving}
                />
              </Field>

              <Field
                label="Customer Web Menu URL"
                htmlFor="settings-client-url"
                hint="The deployed client site link — the Scanner view shows it as a QR customers scan to open the menu and order on their phones. Leave empty to keep the placeholder QR."
              >
                <Input
                  id="settings-client-url"
                  type="url"
                  value={form.clientSiteUrl}
                  onChange={(e) => set("clientSiteUrl", e.target.value)}
                  placeholder="https://your-coffeepp-site.vercel.app"
                  disabled={!isAdmin || saving}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </Field>

              {isAdmin && (
                <Button
                  className="h-11 w-full font-semibold sm:w-auto sm:self-start"
                  onClick={() => void handleSave()}
                  disabled={saving || !form.boothName.trim()}
                >
                  {saving ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Save aria-hidden />
                  )}
                  Save Settings
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Client site menu export (admin → client sync) */}
          {isAdmin && (
            <Card className="gap-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileJson className="h-5 w-5" aria-hidden />
                  </span>
                  Client site menu
                </CardTitle>
                <CardDescription>
                  Export the current menu, prices, and booth details as
                  the exact file the customer site reads.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Replace{" "}
                  <code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                    src/data/menu.json
                  </code>{" "}
                  in the client project with this file, then redeploy the client
                  site.
                </p>
                <Button
                  className="h-11 w-full font-semibold sm:w-auto sm:self-start"
                  onClick={() => void handleExportMenu()}
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <FileJson aria-hidden />
                  )}
                  {exporting ? "Preparing menu…" : "Export coffeepp-menu.json"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* About */}
          <Card className="gap-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" aria-hidden />
                About this system
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Coffee++ is a 3-day campus booth ordering and sales tracking system.
                Customers order from the menu on their phones and show their Order QR at
                the booth; staff scan it, verify payment, and track sales in real time.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
