import Image from "next/image";
import { formatUserName } from "@/lib/utils";

interface HeaderProps {
  user: {
    email: string;
    name: string;
    avatarUrl: string | null;
  };
}

export function Header({ user }: HeaderProps) {
  const name = formatUserName(user.name, user.email);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <a href="/app" className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[#1e3a8a] to-[#c41e2a] text-sm font-bold text-white">
            FF
          </span>
          <span className="text-base font-semibold text-slate-900">FABD Fluxos</span>
        </a>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium text-slate-900">
              {name.first} {name.last}
            </p>
            <p className="text-xs text-slate-500">{user.email}</p>
          </div>
          <div className="size-9 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
            {user.avatarUrl ? (
              <Image
                src={user.avatarUrl}
                alt={name.full}
                width={36}
                height={36}
                className="size-full object-cover"
              />
            ) : (
              <span className="grid size-full place-items-center text-xs font-semibold text-slate-600">
                {name.initials}
              </span>
            )}
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Sair
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
