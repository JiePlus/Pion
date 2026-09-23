// Keep stable class names for extension views and existing browser automation.
export function componentClass(styles: Record<string, string>, name: string) {
  return `${styles[name] ?? ""} ${name}`;
}
