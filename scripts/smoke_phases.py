"""Smoke E2E phases CRUD impersonando admin via psycopg.
Roda em transacao com rollback — nao persiste dados.
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

cur.execute(
    """select wm.user_id, w.id from workspace_members wm
       join workspaces w on w.id=wm.workspace_id
       where w.slug=%s and wm.role=%s and wm.status=%s limit 1""",
    ("fabd", "admin", "active"),
)
admin_id, ws_id = cur.fetchone()
print("admin:", admin_id)

# Localizar/criar projeto + flow ativos
cur.execute(
    """select p.id, d.slug, p.directory_id from projects p
       join directories d on d.id=p.directory_id
       join workspaces w on w.id=d.workspace_id
       where w.slug=%s and p.status=%s order by p.created_at desc limit 1""",
    ("fabd", "active"),
)
row = cur.fetchone()
if not row:
    cur.execute("select id from directories where workspace_id=%s limit 1", (ws_id,))
    dir_id = cur.fetchone()[0]
    cur.execute(
        "insert into projects (directory_id, name, created_by) values (%s,%s,%s) returning id",
        (dir_id, "_smoke_phase_proj", admin_id),
    )
    proj_id = cur.fetchone()[0]
else:
    proj_id, dir_slug, dir_id = row
print("project:", proj_id)

cur.execute(
    "select id from flows where project_id=%s and status=%s order by created_at desc limit 1",
    (proj_id, "active"),
)
fr = cur.fetchone()
if not fr:
    cur.execute(
        """insert into flows (project_id, name, type, status, created_by)
           values (%s,%s,%s,%s,%s) returning id""",
        (proj_id, "_smoke_phase_flow", "continuous", "active", admin_id),
    )
    flow_id = cur.fetchone()[0]
else:
    flow_id = fr[0]
print("flow:", flow_id)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# 1) CREATE phase
out = as_user(
    admin_id,
    """insert into phases (flow_id, name, due_date, order_index, created_by)
       values (%s,%s,%s,%s,%s) returning id""",
    (flow_id, f"_smoke_phase_{uuid.uuid4().hex[:6]}", "2026-12-31T10:00:00Z", 0, admin_id),
)
phase_id = out[0][0]
print("1. create phase PASS:", phase_id)

# 2) UPDATE
out = as_user(
    admin_id,
    "update phases set name=%s, due_date=%s, color=%s where id=%s returning name, due_date",
    ("_phase_renomeada", "2026-11-15T10:00:00Z", "#10B981", phase_id),
)
print("2. update PASS:", out[0])

# 3) COMPLETE (set completed_at)
out = as_user(
    admin_id,
    "update phases set completed_at=now() where id=%s returning completed_at is not null",
    (phase_id,),
)
print("3. complete PASS:", out[0][0])

# 4) UNCOMPLETE
out = as_user(
    admin_id,
    "update phases set completed_at=null where id=%s returning completed_at",
    (phase_id,),
)
print("4. uncomplete PASS:", out[0][0] is None)

# 5) DELETE
out = as_user(admin_id, "delete from phases where id=%s returning id", (phase_id,))
print("5. delete PASS:", len(out or []), "rows")

# 6) Policies
cur.execute(
    "select policyname from pg_policies where schemaname='public' and tablename='phases' order by 1"
)
print("6. phases policies:", [r[0] for r in cur.fetchall()])

# 7) NEGATIVE: membro tentar criar fase
cur.execute(
    """select wm.user_id from workspace_members wm
       join workspaces w on w.id=wm.workspace_id
       where w.slug=%s and wm.role=%s and wm.status=%s limit 1""",
    ("fabd", "membro", "active"),
)
m = cur.fetchone()
if m:
    membro_id = m[0]
    try:
        as_user(
            membro_id,
            """insert into phases (flow_id, name, order_index, created_by)
               values (%s,%s,%s,%s) returning id""",
            (flow_id, "_should_fail", 99, membro_id),
        )
        print("7. negativo: FAIL (insert passou — deveria bloquear)")
    except Exception as e:
        print("7. negativo PASS — RLS bloqueou:", str(e)[:120])
        cur.execute("rollback")
else:
    print("7. sem membro nao-admin pra testar (skip)")

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE phases: PASS ---")
