// Prefills the editable slug input on the university-approval form — the
// server validates whatever the admin actually submits (kebab-case regex)
// and the DB's unique constraint is the real guard, so this doesn't need
// to be perfect.
const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
