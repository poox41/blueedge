import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-medium outline-none transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 focus-visible:border-[var(--color-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-text-primary)]/10 aria-invalid:border-[var(--color-danger)] aria-invalid:ring-2 aria-invalid:ring-[var(--color-danger)]/10",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-text-primary)] text-white shadow-sm hover:bg-[var(--color-brand-dark)]",
        destructive:
          "bg-[var(--color-danger)] text-white shadow-sm hover:bg-[#e5484d] focus-visible:ring-[var(--color-danger)]/20",
        outline:
          "border border-[var(--color-border-strong)] bg-white text-[var(--color-text-primary)] shadow-sm hover:border-[var(--color-input-border-hover)] hover:bg-[var(--color-bg-hover)]",
        secondary:
          "bg-[var(--color-bg-soft)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-active)]",
        ghost:
          "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
        link: "text-[var(--color-brand)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-[9px] px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-10 rounded-[12px] px-6 has-[>svg]:px-4",
        icon: "size-9 rounded-[10px]",
        "icon-sm": "size-8 rounded-[9px]",
        "icon-lg": "size-10 rounded-[12px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
