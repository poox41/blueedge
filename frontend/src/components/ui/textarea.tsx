import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-[var(--color-text-tertiary)] focus-visible:border-[var(--color-text-primary)] focus-visible:ring-[var(--color-text-primary)]/10 aria-invalid:ring-destructive/20 aria-invalid:border-destructive flex field-sizing-content min-h-16 w-full rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-3 py-2 text-base shadow-xs transition-[border-color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:bg-[var(--color-bg-soft)] disabled:opacity-60 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
