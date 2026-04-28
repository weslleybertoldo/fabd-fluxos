"""Smoke E2E reorderFlows via psycopg+RLS impersonando admin.
Roda em transacao com rollback.
"""
import os
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
    """select wm.user_id from workspace_members wm
       join workspaces w on w.id=wm.workspace_id
       where w.slug=%s and wm.role=%s and wm.status=%s limit 1""",
    ("fabd", "admin", "active"),
)
admin_id = cur.fetchone()[0]
print("admin:", admin_id)

# Achar projeto com flows ou criar 3 flows num projeto
cur.execute(
    """select p.id from projects p
       join directories d on d.id=p.directory_id
       join workspaces w on w.id=d.workspace_id
       where w.slug=%s and p.status=%s order by p.created_at desc limit 1""",
    ("fabd", "active"),
)
row = cur.fetchone()
assert row, "Sem projeto pra testar"
proj_id = row[0]
print("project:", proj_id)

# Criar 3 flows temporarios pra reordenar
flow_ids = []
for i, name in enumerate(["A", "B", "C"]):
    cur.execute(
        """insert into flows (project_id, name, type, status, order_index, created_by)
           values (%s,%s,%s,%s,%s,%s) returning id""",
        (proj_id, f"_smoke_flow_{name}", "continuous", "active", i, admin_id),
    )
    flow_ids.append(cur.fetchone()[0])
print("flows criados:", flow_ids)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# Inverter ordem
new_order = list(reversed(flow_ids))
for i, fid in enumerate(new_order):
    out = as_user(
        admin_id,
        "update flows set order_index=%s where id=%s returning order_index",
        (i, fid),
    )
    if not out:
        print(f"   FAIL reorder {fid}")

cur.execute(
    "select name, order_index from flows where project_id=%s and name like %s order by order_index",
    (proj_id, "_smoke_flow_%"),
)
rows = cur.fetchall()
print("flows depois:", rows)
expected = [("_smoke_flow_C", 0), ("_smoke_flow_B", 1), ("_smoke_flow_A", 2)]
if rows == expected:
    print("1. reorder flows PASS")
else:
    print("1. reorder flows FAIL: esperado", expected, "got", rows)

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE reorder flows: DONE ---")
