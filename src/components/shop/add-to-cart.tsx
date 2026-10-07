import { ShoppingCart } from "lucide-react";
import { addToCartAction } from "@/app/(site)/shop-actions";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** Adds a product (or a bundle) to the cart. A plain form, so it works without JavaScript. */
export function AddToCart({ productId, bundleId, label = "Add to cart", withQuantity = false, max = 10, size = "md", idPrefix, name }: { productId?: string; bundleId?: string; label?: string; /** What is added, for screen readers when the label is short. */ name?: string; withQuantity?: boolean; max?: number; size?: "sm" | "md"; idPrefix?: string }) {
  const qid = `${idPrefix ?? productId ?? bundleId}-qty`;
  return (
    <form action={addToCartAction} className="flex items-end gap-2">
      {productId ? <input type="hidden" name="productId" value={productId} /> : null}
      {bundleId ? <input type="hidden" name="bundleId" value={bundleId} /> : null}
      {withQuantity ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={qid} className="text-caption font-semibold text-ink-muted">
            Quantity
          </label>
          <select id={qid} name="quantity" defaultValue="1" className={cn(inputClass, "w-20")}>
            {Array.from({ length: Math.max(1, max) }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <button type="submit" aria-label={name ? `${label} ${name} to your cart` : undefined} className={buttonClass("primary", size, "gap-2")}>
        <ShoppingCart aria-hidden className="size-4" />
        {label}
      </button>
    </form>
  );
}
