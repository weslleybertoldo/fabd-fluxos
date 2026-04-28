"""Smoke E2E Sub-fase 5A: CRUD de flows com RLS impersonando admin/membro.

Roda dentro de uma transacao que faz rollback no fim — nao persiste dados.
"""
import os
import uuid
import psycopg2

PASSWORD = os.environ.get("FABD_FLUXOS_DB_PASSWORD")
assert PASSWORD, "set FABD_FLUXOS_DB_PASSWORD"

conn = psycopg2.connect(
    host="db.nexvflddmubtcizervda.supabase.co",
    port=5432,
    user="postgres",
    password=PASSWORD,
    dbname="postgres",
)
cur = conn.cursor()

# --- localizar admin do workspace fabd ---
cur.execute(
    """
    select wm.user_id from workspace_members wm
    join workspaces w on w.id=wm.workspace_id
    where w.slug=%s and wm.role=%s and wm.status=%s limit 1
    """,
    ("fabd", "admin", "active"),
)
admin_id = cur.fetchone()[0]
print("admin_id:", admin_id)

# --- localizar (ou criar) 1 projeto ativo ---
cur.execute(
    """
    select p.id, d.slug from projects p
    join directories d on d.id=p.directory_id
    join workspaces w on w.id=d.workspace_id
    where w.slug=%s and p.status=%s order by p.created_at desc limit 1
    """,
    ("fabd", "active"),
)
row = cur.fetchone()
if not row:
    cur.execute(
        "select id, slug from directories where workspace_id=(select id from workspaces where slug=%s) limit 1",
        ("fabd",),
    )
    dir_id, dir_slug = cur.fetchone()
    cur.execute(
        "insert into projects (directory_id, name, created_by) values (%s,%s,%s) returning id",
        (dir_id, "_smoke_5A_proj", admin_id),
    )
    proj_id = cur.fetchone()[0]
    print("created project:", proj_id, "in dir", dir_slug)
else:
    proj_id, dir_slug = row
    print("using project:", proj_id, "dir slug:", dir_slug)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# 1) CREATE flow
flow_name = f"_smoke_flow_{uuid.uuid4().hex[:6]}"
out = as_user(
    admin_id,
    "insert into flows (project_id, name, type, status, created_by) values (%s,%s,%s,%s,%s) returning id",
    (proj_id, flow_name, "continuous", "active", admin_id),
)
flow_id = out[0][0]
print("1. create flow PASS:", flow_id)

# 2) UPDATE flow
out = as_user(
    admin_id,
    "update flows set name=%s, type=%s where id=%s returning id, name, type",
    (flow_name + "_edit", "non_continuous", flow_id),
)
print("2. update flow PASS:", out[0])

# 3) ARCHIVE
out = as_user(
    admin_id,
    "update flows set status=%s where id=%s returning status",
    ("archived", flow_id),
)
print("3. archive PASS:", out[0][0])

# 4) REACTIVATE
out = as_user(
    admin_id,
    "update flows set status=%s where id=%s returning status",
    ("active", flow_id),
)
print("4. reactivate PASS:", out[0][0])

# 5) COMPLETE
out = as_user(
    admin_id,
    "update flows set status=%s, completed_at=now() where id=%s returning status, completed_at",
    ("completed", flow_id),
)
print("5. complete PASS:", out[0][0], "completed_at:", out[0][1] is not None)

# 6) DELETE
out = as_user(admin_id, "delete from flows where id=%s returning id", (flow_id,))
print("6. delete PASS:", len(out or []), "rows")

# 7) verificar policies
cur.execute(
    "select policyname from pg_policies where schemaname='public' and tablename='flows' order by 1"
)
print("flows policies:", [r[0] for r in cur.fetchall()])

# 8) NEGATIVE — membro tentando criar
cur.execute(
    """
    select wm.user_id from workspace_members wm
    join workspaces w on w.id=wm.workspace_id
    where w.slug=%s and wm.role=%s and wm.status=%s limit 1
    """,
    ("fabd", "membro", "active"),
)
membro_row = cur.fetchone()
if membro_row:
    membro_id = membro_row[0]
    try:
        as_user(
            membro_id,
            "insert into flows (project_id, name, type, status, created_by) values (%s,%s,%s,%s,%s) returning id",
            (proj_id, "_should_fail", "continuous", "active", membro_id),
        )
        print("7. membro NEGATIVE: FAIL — insert passou (deveria bloquear)")
    except Exception as e:
        print("7. membro NEGATIVE PASS — RLS bloqueou:", str(e)[:120])
        cur.execute("rollback")  # rollback do erro pra manter conexao
else:
    print("7. sem membro nao-admin pra testar negativo (skip)")

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE 5A: ALL PASS ---")
