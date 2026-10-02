const formats = new Map<string, Intl.DateTimeFormat>();
export function dateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const key = JSON.stringify([locale, options]);
  let formatter = formats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formats.set(key, formatter);
    if (formats.size > 64) formats.delete(formats.keys().next().value!);
  }
  return formatter;
}
