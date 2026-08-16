/**
 * Number formatting. Eco costs span a huge range — a fuel is priced in
 * millionths of a currency unit per joule while a shipyard runs to hundreds —
 * so a single fixed precision is unreadable at one end or the other.
 */

/** Formats a cost, keeping small values legible without drowning large ones. */
export function money(value: number | null | undefined, dash = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return dash;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return '0';
  if (magnitude >= 100) return value.toFixed(2);
  if (magnitude >= 1) return trim(value.toFixed(3));
  if (magnitude >= 0.001) return trim(value.toFixed(5));
  return value.toPrecision(3);
}

/** Formats an ingredient quantity, which is often fractional after multipliers. */
export function amount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return String(value);
  return trim(value.toFixed(3));
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${trim((value * 100).toFixed(1))}%`;
}

export function multiplier(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `×${trim(value.toFixed(4))}`;
}

/**
 * Names a recipe by its table as well as itself.
 *
 * Competing recipes are often told apart only by where they're made — Crushed
 * Gold Ore comes off an Arrastra, a Stamp Mill, a Rocker Box or a Jaw Crusher —
 * so the name alone isn't enough to choose between them.
 */
export function recipeLabel(name: string, table: string): string {
  return table ? `${name} @ ${table}` : name;
}

/** Drops trailing zeros so 1.500 reads as 1.5 and 2.000 as 2. */
function trim(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}
