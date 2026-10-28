/** Logs an error the page catches to show the visitor instead of throwing, so the
 * console and the site error log keep its stack and properties. Returns the text
 * to display. */
export function shownError(cause: unknown): string {
  console.error(cause);
  return cause instanceof Error ? cause.message : String(cause);
}
