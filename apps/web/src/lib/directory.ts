/** Pega 2 letras maiusculas pra fallback do thumb da diretoria. */
export function directoryInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
