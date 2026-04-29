"use client";

import { Icon } from "@iconify/react";

interface Props {
  /** Ex: "mdi:trophy-outline", "mdi:scale-balance", "lucide:briefcase" */
  icon: string | null;
  /** Iniciais usadas como fallback quando icon e imageUrl sao null */
  initials: string;
  /** URL da imagem custom (override visual). Se setado, ignora icon e initials. */
  imageUrl: string | null;
  /** Cor de fundo (hex). Usada quando renderiza icon ou initials. */
  bg: string;
  /** Tamanho da caixa em px. Default 56 (3.5rem). */
  sizePx?: number;
  /** Tamanho do icone Iconify em px. Default = sizePx * 0.5. */
  iconSize?: number;
  /** Nome da diretoria pra alt text */
  alt?: string;
}

/**
 * Avatar visual da diretoria. Prioriza:
 *   1. imageUrl (foto que o admin subiu)
 *   2. icon (Iconify, ex `mdi:trophy-outline`)
 *   3. iniciais (fallback)
 */
export function DirectoryIcon({
  icon,
  initials,
  imageUrl,
  bg,
  sizePx = 56,
  iconSize,
  alt = "",
}: Props) {
  const finalIconSize = iconSize ?? Math.round(sizePx * 0.5);
  return (
    <div
      className="grid place-items-center overflow-hidden rounded-2xl text-base font-bold text-white"
      style={{ backgroundColor: bg, width: sizePx, height: sizePx }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={alt} className="h-full w-full object-cover" />
      ) : icon ? (
        <Icon icon={icon} width={finalIconSize} height={finalIconSize} />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

// directoryInitials vive em `@/lib/directory` (modulo neutro). Importe direto
// de la em RSC ou client — exportar daqui causaria erro pq este arquivo tem
// 'use client' e RSC nao pode chamar funcoes de modulos client.
