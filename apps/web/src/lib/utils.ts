import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUserName(
  fullName: string | null | undefined,
  fallback = "Usuario",
): { first: string; last: string; initials: string; full: string } {
  if (!fullName) {
    return { first: fallback, last: "", initials: fallback.slice(0, 2).toUpperCase(), full: fallback };
  }
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] ?? fallback;
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const initials = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || fallback.slice(0, 2).toUpperCase();
  return { first, last, initials, full: fullName };
}
