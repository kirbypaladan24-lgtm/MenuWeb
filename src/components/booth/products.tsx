"use client";

// Products — booth menu management. Admin can create / edit / toggle / delete;
// staff gets a read-only view.

import * as React from "react";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Package, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import { formatPeso } from "@/lib/format";
import type { Product } from "@/lib/types";
import { BOOTH_QK, asList, useApiError } from "./booth-utils";
import { ViewHeader } from "./view-header";

interface SizeFormRow {
  name: string;
  price: string;
}

interface FieldFormRow {
  label: string;
  required: boolean;
}

interface ProductFormState {
  id: string;
  name: string;
  description: string;
  price: string;
  category: string;
  image: string;
  hasTemperature: boolean;
  defaultTemperature: "" | "HOT" | "COLD"; // "" = no fixed serving temp
  hasSizes: boolean;
  sizes: SizeFormRow[];
  hasFields: boolean;
  fields: FieldFormRow[];
}

const EMPTY_FORM: ProductFormState = {
  id: "",
  name: "",
  description: "",
  price: "",
  category: "Drinks",
  image: "",
  hasTemperature: false,
  defaultTemperature: "",
  hasSizes: false,
  sizes: [],
  hasFields: false,
  fields: [],
};

function toForm(p: Product): ProductFormState {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: String(p.price ?? ""),
    category: p.category,
    image: p.image,
    hasTemperature: p.hasTemperature,
    defaultTemperature:
      !p.hasTemperature && (p.defaultTemperature === "HOT" || p.defaultTemperature === "COLD")
        ? p.defaultTemperature
        : "",
    hasSizes: p.hasSizes,
    sizes: (p.sizes ?? []).map((s) => ({ name: s.name, price: String(s.price) })),
    hasFields: p.hasFields,
    fields: (p.fields ?? []).map((f) => ({ label: f.label, required: f.required })),
  };
}

function ProductFormDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const apiError = useApiError();
  const [form, setForm] = React.useState<ProductFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = React.useState(false);
  const editing = product !== null;

  React.useEffect(() => {
    if (open) {
      setForm(product ? toForm(product) : EMPTY_FORM);
    }
  }, [open, product]);

  function set<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    const name = form.name.trim();
    const price = Number(form.price);
    const id = form.id.trim().toUpperCase();
    const category = form.category;
    const image = form.image.trim(); // empty is fine — the card falls back to a house photo
    // Fixed serving temp — only meaningful when customers get no Hot/Cold choice.
    const defaultTemperature =
      !form.hasTemperature && form.defaultTemperature !== "" ? form.defaultTemperature : null;

    if (!name) {
      toast({
        title: "Check the form",
        description: "Product name is required.",
        variant: "destructive",
      });
      return;
    }
    if (!(price > 0)) {
      toast({
        title: "Check the form",
        description: "Price must be a positive number of pesos.",
        variant: "destructive",
      });
      return;
    }
    if (!editing && !/^[A-Z]{2}-\d{3}$/.test(id)) {
      toast({
        title: "Check the form",
        description: "ID must look like CF-001 (2 letters, dash, 3 digits).",
        variant: "destructive",
      });
      return;
    }
    // Size menu — only when the flag is on; validated here so the server
    // never has to guess (it re-validates anyway).
    let sizes: { name: string; price: number }[] = [];
    if (form.hasSizes) {
      const seen = new Set<string>();
      for (const row of form.sizes) {
        const name = row.name.trim().slice(0, 20);
        const sizePrice = Number(row.price);
        if (!name) {
          toast({
            title: "Check the form",
            description: "Every size needs a name.",
            variant: "destructive",
          });
          return;
        }
        if (!(sizePrice >= 0) || !Number.isInteger(sizePrice)) {
          toast({
            title: "Check the form",
            description: `Size "${name}" needs a whole-peso price (0 or more).`,
            variant: "destructive",
          });
          return;
        }
        if (seen.has(name.toLowerCase())) {
          toast({
            title: "Check the form",
            description: `Duplicate size name "${name}".`,
            variant: "destructive",
          });
          return;
        }
        seen.add(name.toLowerCase());
        sizes.push({ name, price: sizePrice });
      }
      if (sizes.length === 0) {
        toast({
          title: "Check the form",
          description: "Add at least 1 size — or switch sizes off.",
          variant: "destructive",
        });
        return;
      }
    }
    // Custom inputs — same deal: validated here, re-validated server-side.
    let fields: { label: string; required: boolean }[] = [];
    if (form.hasFields) {
      const seenLabels = new Set<string>();
      for (const row of form.fields) {
        const label = row.label.trim().slice(0, 30);
        if (!label) {
          toast({
            title: "Check the form",
            description: "Every input needs a label (what to ask).",
            variant: "destructive",
          });
          return;
        }
        if (seenLabels.has(label.toLowerCase())) {
          toast({
            title: "Check the form",
            description: `Duplicate input label "${label}".`,
            variant: "destructive",
          });
          return;
        }
        seenLabels.add(label.toLowerCase());
        fields.push({ label, required: row.required });
      }
      if (fields.length === 0) {
        toast({
          title: "Check the form",
          description: "Add at least 1 input — or switch custom inputs off.",
          variant: "destructive",
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      if (editing) {
        await apiFetch(`/api/products/${product.id}`, {
          method: "PATCH",
          json: {
            name,
            description: form.description.trim(),
            price,
            image,
            category,
            hasTemperature: form.hasTemperature,
            defaultTemperature,
            hasSizes: form.hasSizes,
            sizes,
            hasFields: form.hasFields,
            fields,
          },
        });
      } else {
        await apiFetch("/api/products", {
          method: "POST",
          json: {
            id,
            name,
            description: form.description.trim(),
            price,
            image,
            category,
            hasTemperature: form.hasTemperature,
            defaultTemperature,
            hasSizes: form.hasSizes,
            sizes,
            hasFields: form.hasFields,
            fields,
            available: true,
          },
        });
      }
      toast({
        title: "✓ Product saved",
        description: `${name} was ${editing ? "updated" : "added"} successfully.`,
      });
      onOpenChange(false);
      onSaved();
    } catch (err) {
      apiError(err, "Could not save this product.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto scroll-thin sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${product?.name}` : "Add Product"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the product details below."
              : "New products become available on the customer menu immediately."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!editing && (
            <div className="grid gap-2">
              <Label htmlFor="product-id">Product ID</Label>
              <Input
                id="product-id"
                value={form.id}
                onChange={(e) => set("id", e.target.value.toUpperCase())}
                placeholder="CF-001"
                autoCapitalize="characters"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Format: two letters + dash + 3 digits (e.g. CF-001, FD-002).
              </p>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="product-name">Name</Label>
            <Input
              id="product-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Spanish Latte"
              disabled={submitting}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="product-description">Description</Label>
            <Textarea
              id="product-description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Short menu description shown to customers."
              rows={2}
              disabled={submitting}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="product-price">Price (₱)</Label>
              <Input
                id="product-price"
                type="number"
                min={1}
                value={form.price}
                onChange={(e) => set("price", e.target.value)}
                placeholder="49"
                inputMode="numeric"
                disabled={submitting}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="product-category">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => set("category", v)}
                disabled={submitting}
              >
                <SelectTrigger id="product-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="product-image">Image path</Label>
            <Input
              id="product-image"
              value={form.image}
              onChange={(e) => set("image", e.target.value)}
              placeholder="/images/products/ClassicCoffee.jpg"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Put the photo in public/images/products/ and reference it here,
              e.g. /images/products/SpanishLatte.jpg (square images look best).
              Leave empty to reuse the house coffee photo.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label htmlFor="product-temp" className="cursor-pointer">
                HOT / COLD option
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Let customers choose a temperature for this item.
              </p>
            </div>
            <Switch
              id="product-temp"
              checked={form.hasTemperature}
              onCheckedChange={(v) =>
                set("hasTemperature", v)
              }
              disabled={submitting}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label htmlFor="product-sizes" className="cursor-pointer">
                Size choices
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Let customers pick a size — each size has its own price.
              </p>
            </div>
            <Switch
              id="product-sizes"
              checked={form.hasSizes}
              onCheckedChange={(v) =>
                set("hasSizes", v)
              }
              disabled={submitting}
            />
          </div>

          {/* Size menu — only used while the flag above is on. */}
          {form.hasSizes && (
            <div className="grid gap-2 rounded-md border p-3">
              <Label>Sizes &amp; prices</Label>
              {form.sizes.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={row.name}
                    onChange={(e) =>
                      set(
                        "sizes",
                        form.sizes.map((r, j) =>
                          j === i ? { ...r, name: e.target.value } : r
                        )
                      )
                    }
                    placeholder="Large"
                    maxLength={20}
                    disabled={submitting}
                    aria-label={`Size ${i + 1} name`}
                  />
                  <Input
                    value={row.price}
                    onChange={(e) =>
                      set(
                        "sizes",
                        form.sizes.map((r, j) =>
                          j === i ? { ...r, price: e.target.value } : r
                        )
                      )
                    }
                    placeholder="₱"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="w-24 shrink-0"
                    disabled={submitting}
                    aria-label={`Size ${i + 1} price in pesos`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() =>
                      set(
                        "sizes",
                        form.sizes.filter((_, j) => j !== i)
                      )
                    }
                    disabled={submitting}
                    aria-label={`Remove size ${row.name || i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {form.sizes.length < 6 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    set("sizes", [...form.sizes, { name: "", price: "" }])
                  }
                  disabled={submitting}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add size
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Up to 6 sizes. The base price above stays as the fallback for
                old orders made before sizes existed.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label htmlFor="product-fields" className="cursor-pointer">
                Custom inputs
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ask customers to fill something in — each with optional/required.
              </p>
            </div>
            <Switch
              id="product-fields"
              checked={form.hasFields}
              onCheckedChange={(v) =>
                set("hasFields", v)
              }
              disabled={submitting}
            />
          </div>

          {/* Custom inputs — only used while the flag above is on. */}
          {form.hasFields && (
            <div className="grid gap-2 rounded-md border p-3">
              <Label>Inputs to ask</Label>
              {form.fields.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={row.label}
                    onChange={(e) =>
                      set(
                        "fields",
                        form.fields.map((r, j) =>
                          j === i ? { ...r, label: e.target.value } : r
                        )
                      )
                    }
                    placeholder="e.g. Dedication"
                    maxLength={30}
                    disabled={submitting}
                    aria-label={`Input ${i + 1} label`}
                  />
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Switch
                      id={`product-field-required-${i}`}
                      checked={row.required}
                      onCheckedChange={(v) =>
                        set(
                          "fields",
                          form.fields.map((r, j) =>
                            j === i ? { ...r, required: v } : r
                          )
                        )
                      }
                      disabled={submitting}
                      aria-label={`Require an answer for ${row.label || `input ${i + 1}`}`}
                    />
                    <Label
                      htmlFor={`product-field-required-${i}`}
                      className="cursor-pointer text-xs font-medium text-muted-foreground"
                    >
                      Required
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() =>
                      set(
                        "fields",
                        form.fields.filter((_, j) => j !== i)
                      )
                    }
                    disabled={submitting}
                    aria-label={`Remove input ${row.label || i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {form.fields.length < 4 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    set("fields", [...form.fields, { label: "", required: false }])
                  }
                  disabled={submitting}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add input
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Up to 4 inputs. Answers ride inside the Order QR and show on
                every order card.
              </p>
            </div>
          )}

          {/* Fixed serving temperature — only for items WITHOUT the Hot/Cold choice. */}
          {!form.hasTemperature && (
            <div className="grid gap-2">
              <Label htmlFor="product-default-temp">Serving temperature</Label>
              <Select
                value={form.defaultTemperature}
                onValueChange={(v) =>
                  set("defaultTemperature", v as "" | "HOT" | "COLD")
                }
                disabled={submitting}
              >
                <SelectTrigger id="product-default-temp" className="w-full">
                  <SelectValue placeholder="No temperature" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOT">Hot — served hot</SelectItem>
                  <SelectItem value="COLD">Cold — served iced/chilled</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                No temperature choice is offered for this item — this tells
                customers what they&apos;re getting (shown as a Hot/Cold badge on
                the menu and stamped onto their order). Leave empty for
                non-drinks like pastries.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="h-10">
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting} className="h-10">
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {editing ? "Save Changes" : "Add Product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsView() {
  // No sign-in: the console runs on the booth laptop and always has full access.
  const isAdmin = true;
  const { toast } = useToast();
  const apiError = useApiError();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["booth", "products"],
    queryFn: () => apiFetch<unknown>("/api/products"),
  });

  const products = React.useMemo(() => asList<Product>(data, "products"), [data]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const [deleting, setDeleting] = React.useState<Product | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [toggleBusy, setToggleBusy] = React.useState<string | null>(null);

  async function invalidateAll() {
    await queryClient.invalidateQueries({ queryKey: BOOTH_QK });
  }

  async function handleToggle(p: Product) {
    setToggleBusy(p.id);
    try {
      await apiFetch(`/api/products/${p.id}`, {
        method: "PATCH",
        json: { available: !p.available },
      });
      toast({
        title: "✓ Updated",
        description: `${p.name} is now ${p.available ? "hidden from the menu" : "available"}.`,
      });
      await invalidateAll();
    } catch (err) {
      apiError(err, "Could not update availability.");
    } finally {
      setToggleBusy(null);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/products/${deleting.id}`, { method: "DELETE" });
      toast({
        title: "✓ Product deleted",
        description: `${deleting.name} was removed from the menu.`,
      });
      setDeleting(null);
      await invalidateAll();
    } catch (err) {
      apiError(err, "Could not delete this product.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      <ViewHeader
        title="Products"
        description="Manage the booth menu — items, prices, and availability."
        action={
          isAdmin && (
            <Button
              className="h-11 font-semibold"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus aria-hidden />
              Add Product
            </Button>
          )
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-[420px] rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<RefreshCw className="h-6 w-6" aria-hidden />}
          title="Couldn't load products"
          description="Check your connection and try again."
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Try Again
            </Button>
          }
        />
      ) : products.length === 0 ? (
        <EmptyState
          icon={<Package className="h-6 w-6" aria-hidden />}
          title="No products yet"
          description={
            isAdmin
              ? "Add your first booth item to open the menu."
              : "The menu has no items yet."
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => {
            return (
              <Card key={p.id} className="gap-3 py-4">
                <CardContent className="space-y-3 px-4">
                  {/* Big square photo — the product image is the hero of the card */}
                  <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-muted">
                    <Image
                      src={p.image || "/images/products/ClassicCoffee.jpg"}
                      alt={p.name}
                      fill
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-semibold text-foreground">{p.name}</p>
                        <Badge variant="secondary" className="text-[10px]">
                          {p.category}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.id}
                        {p.hasTemperature
                          ? " · HOT / COLD"
                          : p.defaultTemperature === "HOT"
                            ? " · SERVED HOT"
                            : p.defaultTemperature === "COLD"
                              ? " · SERVED COLD"
                              : ""}
                        {p.hasSizes && p.sizes.length > 0
                          ? ` · ${p.sizes.length} sizes`
                          : ""}
                        {p.hasFields && p.fields.length > 0
                          ? ` · ${p.fields.length} inputs`
                          : ""}
                      </p>
                      <p className="mt-1 text-base font-bold text-foreground">
                        {p.hasSizes && p.sizes.length > 0
                          ? `From ${formatPeso(Math.min(...p.sizes.map((s) => s.price)))} · ${p.sizes.length} sizes`
                          : formatPeso(p.price)}
                      </p>
                    </div>
                    {isAdmin && (
                      <Switch
                        checked={p.available}
                        onCheckedChange={() => void handleToggle(p)}
                        disabled={toggleBusy === p.id}
                        aria-label={`Toggle availability for ${p.name}`}
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge
                      variant="secondary"
                      className={
                        p.available
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-destructive/30 bg-destructive/10 text-destructive"
                      }
                    >
                      {p.available ? "Available" : "Hidden"}
                    </Badge>
                    <span className="text-muted-foreground">
                      Sold: {typeof p.sold === "number" ? p.sold : 0}
                    </span>
                  </div>

                  {isAdmin && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          setEditing(p);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil aria-hidden />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleting(p)}
                      >
                        <Trash2 aria-hidden />
                        Delete
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <ProductFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          product={editing}
          onSaved={() => void invalidateAll()}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} ({deleting?.id}) will be removed from the menu. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleteBusy}
            >
              {deleteBusy ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete Product
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
