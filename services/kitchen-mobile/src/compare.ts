/** Orders text as `String.prototype.localeCompare` does, with one collator instead of a new one for each comparison. */
export const compareText = new Intl.Collator().compare;
