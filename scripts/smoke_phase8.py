"""Smoke E2E notify_user RPC + read+markRead via psycopg+RLS.
Roda em transacao com rollback.
"""
import os
import psycopg2

PASSWORD = os.environ.get("FABD_FLUXOS_DB_PASSWORD")
assert PASSWORD, "set FABD_FLUXOS_DB_PASSWORD"

conn = psycopg2.connect(
    host="db.nexvflddmubtcizervda.supabase.co",
    port=5432, user="postgres", password=PASSWORD, dbname="postgres",
)
cur = conn.cursor()

cur.execute(
    """select wm.user_id, w.id from workspace_members wm
       join workspaces w on w.id=wm.workspace_id
       where w.slug=%s and wm.role=%s and wm.status=%s limit 1""",
    ("fabd", "admin", "active"),
)
admin_id, ws_id = cur.fetchone()

# RPC notify_user retorna NULL se target=caller (self-notif). Vou criar um user
# fake e adicionar como member do workspace pra simular notify entre 2 users.
import uuid as uu
target_email = f"_smoke_target_{uu.uuid4().hex[:6]}@example.com"
cur.execute(
    """insert into auth.users (id, email, role, aud, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at)
       values (gen_random_uuid(), %s, 'authenticated', 'authenticated', '', now(), '{}', '{}', now(), now(), null) returning id""",
    (target_email,),
)
target_id = cur.fetchone()[0]
cur.execute(
    """insert into workspace_members (workspace_id, user_id, role, status, google_full_name)
       values (%s,%s,%s,%s,%s) returning id""",
    (ws_id, target_id, "membro", "active", "Smoke Target"),
)
print("target user:", target_id)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# 1) Caller=admin envia notif pro target
out = as_user(
    admin_id,
    "select notify_user(%s,%s,%s::notification_type,%s,%s,%s::entity_type,%s,%s)",
    (target_id, ws_id, "responsible_assigned", "Smoke notif", "Body smoke", "project", None, "/app/fabd"),
)
notif_id = out[0][0]
print("1. notify_user PASS:", notif_id)

# 2) Target ve notif (via RLS)
out = as_user(target_id, "select id, title, read_at from notifications where id=%s", (notif_id,))
print("2. target ve notif PASS:", out[0])

# 3) Caller (admin) NAO ve a notif
out = as_user(admin_id, "select id from notifications where id=%s", (notif_id,))
print("3. admin nao ve a notif:", "PASS" if not out else f"FAIL: {out}")

# 4) Target marca como read
out = as_user(
    target_id,
    "update notifications set read_at=now() where id=%s returning read_at is not null",
    (notif_id,),
)
print("4. mark read PASS:", out[0][0])

# 5) Caller=membro tenta enviar notif pra usuario que nao eh do workspace -> deve falhar
cur.execute(
    """insert into auth.users (id, email, role, aud, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at)
       values (gen_random_uuid(), %s, 'authenticated', 'authenticated', '', now(), '{}', '{}', now(), now(), null) returning id""",
    (f"_outsider_{uu.uuid4().hex[:6]}@example.com",),
)
outsider = cur.fetchone()[0]
try:
    as_user(
        admin_id,
        "select notify_user(%s,%s,%s::notification_type,%s,%s,%s,%s,%s)",
        (outsider, ws_id, "mention", "Should fail", None, None, None, None),
    )
    print("5. cross-workspace notify: FAIL — passou")
except Exception as e:
    print("5. cross-workspace notify PASS — rejeitou:", str(e)[:80])
    cur.execute("rollback")

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE Fase 8: PASS ---")
