import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-[var(--color-text-tertiary)] selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-[10px] border-2 border-[var(--color-input-border)] bg-white px-3 py-1 text-base shadow-xs transition-[border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--color-bg-soft)] disabled:opacity-60 md:text-sm",
        "focus-visible:border-[var(--color-text-primary)] focus-visible:ring-[var(--color-text-primary)]/10 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
