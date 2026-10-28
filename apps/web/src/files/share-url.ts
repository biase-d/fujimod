/** Accept only the read-only capability returned by the upload service. */
export function isShareUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^https:\/\/share\.fujimod\.com\/contribution\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  );
}
