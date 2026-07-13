import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-lg border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow] focus-visible:border-[var(--color-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-text-primary)]/10 aria-invalid:border-[var(--color-danger)] aria-invalid:ring-2 aria-invalid:ring-[var(--color-danger)]/10 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--color-text-primary)] text-white [a&]:hover:bg-[var(--color-brand-dark)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-bg-soft)] text-[var(--color-text-secondary)] [a&]:hover:bg-[var(--color-bg-active)]",
        destructive:
          "border-transparent bg-[var(--color-danger)] text-white [a&]:hover:bg-[#e5484d] focus-visible:ring-[var(--color-danger)]/20",
        outline:
          "border-[var(--color-border-strong)] bg-white text-[var(--color-text-secondary)] [a&]:hover:bg-[var(--color-bg-hover)] [a&]:hover:text-[var(--color-text-primary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
