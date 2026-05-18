"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Searchable single-select dropdown.
 *
 * Designed for the TTS voice picker where the list can grow to dozens
 * of celestial-named voices (Achernar, Algenib, …). Operators rarely
 * need more than the top few, so we cap the initially-shown rows at
 * `limit` (default 5) and reveal the rest only when the user types
 * a search query — that's the "limit 5, scroll, search" UX the user
 * asked for. Internally we always render the full list (so scroll +
 * keyboard navigation work uniformly), but a CSS max-height on the
 * scroll viewport keeps only ~5 visible until the user scrolls.
 *
 * Generic over the option type — pass `getValue` + `getLabel` for
 * any shape. The default render assumes `{ value, label }`.
 */
export interface SearchableSelectOption {
  value: string;
  label: string;
  // Optional secondary text shown below the label (e.g. voice gender).
  hint?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No match.",
  limit = 5,
  disabled = false,
  className,
}: {
  options: SearchableSelectOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  limit?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  // Always include the currently-selected option in the visible set
  // (pin it), so a value stored from a deleted voice or one not in
  // the curated list doesn't silently disappear. Useful when an org
  // had a Wavenet voice configured before the Chirp 3 HD upgrade —
  // the dropdown still shows the stored value (suffixed "legacy")
  // so the operator can intentionally migrate it instead of losing
  // it on save.
  const selected = options.find((o) => o.value === value);
  const renderedOptions = React.useMemo<SearchableSelectOption[]>(() => {
    if (!value || selected) return options;
    // Synthesize a pinned entry for the orphaned value. We strip
    // common TTS prefixes for the label, but fall through to the
    // raw value if no prefix matched. The "(legacy)" hint nudges
    // the operator that this voice is outside the curated set.
    const label = value.replace(/^[a-z]{2}-[A-Z]{2}-(?:Chirp3-HD-|Chirp3-|Wavenet-|Neural2-|Studio-|Standard-)/, "");
    return [{ value, label, hint: "legacy — pick a new voice to upgrade" }, ...options];
  }, [options, value, selected]);

  // Row height: each CommandItem is ~36px including padding. 5 rows
  // ≈ 180px. The CommandList component handles its own overflow-y
  // scroll once content exceeds max-height.
  const ROW_PX = 36;
  const maxHeight = limit * ROW_PX;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        // Match trigger width so the dropdown lines up with the input it
        // expands from. Radix exposes the trigger width via a CSS var.
        className="p-0 w-[--radix-popover-trigger-width]"
        align="start"
      >
        <Command shouldFilter={true}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList style={{ maxHeight }}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {renderedOptions.map((opt) => (
                <CommandItem
                  // value is what cmdk's fuzzy filter sees. Include
                  // both label + hint so search matches either.
                  key={opt.value}
                  value={`${opt.label} ${opt.hint || ""} ${opt.value}`}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-sm">{opt.label}</span>
                    {opt.hint && (
                      <span className="text-xs text-muted-foreground truncate">{opt.hint}</span>
                    )}
                  </div>
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === opt.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
