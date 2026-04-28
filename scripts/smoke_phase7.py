"""Smoke E2E reminders + simple_lists + items via psycopg+RLS.
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

cur.execute(
    """select p.id from projects p
       join directories d on d.id=p.directory_id
       where d.workspace_id=%s and p.status='active' order by p.created_at desc limit 1""",
    (ws_id,),
)
proj_id = cur.fetchone()[0]
print("project:", proj_id)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# 1) Reminder
out = as_user(
    admin_id,
    "insert into reminders (project_id, name, due_date, created_by) values (%s,%s,%s,%s) returning id",
    (proj_id, "_smoke_rmd", "2026-12-31T10:00:00Z", admin_id),
)
rmd_id = out[0][0]
print("1. reminder create PASS:", rmd_id)

out = as_user(
    admin_id,
    "update reminders set completed_at=now() where id=%s returning completed_at is not null",
    (rmd_id,),
)
print("2. reminder complete PASS:", out[0][0])

out = as_user(admin_id, "delete from reminders where id=%s returning id", (rmd_id,))
print("3. reminder delete PASS:", len(out or []))

# 2) Simple list + items
out = as_user(
    admin_id,
    "insert into simple_lists (project_id, name, created_by) values (%s,%s,%s) returning id",
    (proj_id, "_smoke_list", admin_id),
)
list_id = out[0][0]
print("4. list create PASS:", list_id)

out = as_user(
    admin_id,
    "insert into simple_list_items (list_id, text, created_by) values (%s,%s,%s) returning id",
    (list_id, "comprar trofeus", admin_id),
)
item_id = out[0][0]
print("5. list item create PASS:", item_id)

out = as_user(
    admin_id,
    "update simple_list_items set completed_at=now() where id=%s returning completed_at is not null",
    (item_id,),
)
print("6. list item complete PASS:", out[0][0])

out = as_user(admin_id, "delete from simple_list_items where id=%s returning id", (item_id,))
print("7. list item delete PASS:", len(out or []))

out = as_user(admin_id, "delete from simple_lists where id=%s returning id", (list_id,))
print("8. list delete PASS:", len(out or []))

# 3) Policies
cur.execute(
    "select tablename, count(*) from pg_policies where schemaname='public' and tablename in ('reminders','simple_lists','simple_list_items') group by tablename order by 1"
)
print("9. policies:", cur.fetchall())

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE Fase 7: PASS ---")
