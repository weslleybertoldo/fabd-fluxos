import Image from "next/image";
import { formatUserName, cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const sizeMap: Record<Size, { box: string; text: string; image: number }> = {
  sm: { box: "size-7", text: "text-[10px]", image: 28 },
  md: { box: "size-9", text: "text-xs", image: 36 },
  lg: { box: "size-12", text: "text-sm", image: 48 },
};

export function MemberAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: Size;
  className?: string;
}) {
  const n = formatUserName(name ?? null);
  const s = sizeMap[size];
  return (
    <div
      className={cn(
        "overflow-hidden rounded-full border border-slate-200 bg-slate-100",
        s.box,
        className,
      )}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={n.full}
          width={s.image}
          height={s.image}
          className="size-full object-cover"
        />
      ) : (
        <span className={cn("grid size-full place-items-center font-semibold text-slate-600", s.text)}>
          {n.initials}
        </span>
      )}
    </div>
  );
}
