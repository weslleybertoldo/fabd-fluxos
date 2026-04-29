"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications";
import { PushSubscribeButton } from "./push-subscribe";
import type { NotificationRow } from "@/lib/types";

function PushSection() {
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) return null;
  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <PushSubscribeButton vapidPublicKey={vapid} />
    </div>
  );
}

interface Props {
  workspaceSlug: string;
  initialUnreadCount: number;
  initialNotifications: NotificationRow[];
}

const TYPE_ICON: Record<string, string> = {
  phase_due_soon: "⏰",
  phase_overdue: "🔴",
  flow_completed: "✅",
  mention: "💬",
  member_request: "👤",
  member_approved: "✓",
  responsible_assigned: "📌",
};

export function NotificationsBell({
  workspaceSlug,
  initialUnreadCount,
  initialNotifications,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>(initialNotifications);
  const [unread, setUnread] = useState<number>(initialUnreadCount);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Sync com props quando o servidor manda novas
  useEffect(() => {
    setItems(initialNotifications);
    setUnread(initialUnreadCount);
  }, [initialNotifications, initialUnreadCount]);

  // Fecha ao clicar fora
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function refresh() {
    const r = await getMyNotifications({ workspaceSlug, limit: 30 });
    if (r.ok) {
      setItems(r.data.notifications);
      setUnread(r.data.unreadCount);
    }
  }

  function handleMarkOne(n: NotificationRow) {
    if (n.read_at) return;
    start(async () => {
      await markNotificationRead({
        workspaceSlug,
        notificationId: n.id,
      });
      await refresh();
    });
  }

  function handleMarkAll() {
    start(async () => {
      await markAllNotificationsRead({ workspaceSlug });
      await refresh();
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) refresh();
        }}
        aria-label="Notificacoes"
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 origin-top-right rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Notificacoes</h3>
            {unread > 0 ? (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={pending}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                Marcar tudo como lido
              </button>
            ) : null}
          </div>

          <PushSection />

          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Nenhuma notificacao
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`px-4 py-3 ${
                    n.read_at ? "bg-white" : "bg-blue-50"
                  } hover:bg-slate-50`}
                >
                  <NotificationItem
                    notif={n}
                    pending={pending}
                    onClick={() => handleMarkOne(n)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NotificationItem({
  notif,
  pending,
  onClick,
}: {
  notif: NotificationRow;
  pending: boolean;
  onClick: () => void;
}) {
  const icon = TYPE_ICON[notif.type] ?? "🔔";
  const content = (
    <div className="flex items-start gap-2">
      <span className="text-base leading-none" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{notif.title}</p>
        {notif.body ? (
          <p className="line-clamp-2 text-xs text-slate-600">{notif.body}</p>
        ) : null}
        <p className="mt-0.5 text-[10px] text-slate-400">
          {formatRelative(notif.created_at)}
        </p>
      </div>
      {!notif.read_at ? (
        <span
          aria-hidden
          className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600"
        />
      ) : null}
    </div>
  );

  if (notif.link) {
    return (
      <Link
        href={notif.link}
        onClick={onClick}
        className={`block ${pending ? "opacity-50" : ""}`}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="w-full text-left"
    >
      {content}
    </button>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
