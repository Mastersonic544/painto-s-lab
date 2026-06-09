export type ClassValue = string | number | false | null | undefined;

export function cn(...parts: ClassValue[]) {
  return parts.filter(Boolean).join(' ');
}
