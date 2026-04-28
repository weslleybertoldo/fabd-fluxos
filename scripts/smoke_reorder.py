"""Smoke E2E reorder phases + directories via psycopg+RLS impersonando admin.
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
    """select wm.user_id, w.id from workspace_members wm
       join workspaces w on w.id=wm.workspace_id
       where w.slug=%s and wm.role=%s and wm.status=%s limit 1""",
    ("fabd", "admin", "active"),
)
admin_id, ws_id = cur.fetchone()
print("admin:", admin_id)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# 1) Reorder directories: troca os 2 primeiros
cur.execute(
    "select id, name, order_index from directories where workspace_id=%s order by order_index limit 3",
    (ws_id,),
)
dirs = cur.fetchall()
print("dirs antes:", [(d[1], d[2]) for d in dirs])
if len(dirs) >= 2:
    new_order = [dirs[1][0], dirs[0][0]] + [d[0] for d in dirs[2:]]
    for i, did in enumerate(new_order):
        out = as_user(
            admin_id,
            "update directories set order_index=%s where id=%s returning order_index",
            (i, did),
        )
        if not out:
            print(f"   FAIL reorder {did}")
    cur.execute(
        "select id, name, order_index from directories where workspace_id=%s order by order_index limit 3",
        (ws_id,),
    )
    print("dirs depois:", [(d[1], d[2]) for d in cur.fetchall()])
    print("1. reorder directories PASS")

# 2) Reorder phases — usar fluxo qualquer
cur.execute(
    """select f.id from flows f
       join projects p on p.id=f.project_id
       join directories d on d.id=p.directory_id
       where d.workspace_id=%s order by f.created_at desc limit 1""",
    (ws_id,),
)
fr = cur.fetchone()
if fr:
    flow_id = fr[0]
    # criar 3 fases temporarias
    phase_ids = []
    for i, name in enumerate(["A", "B", "C"]):
        cur.execute(
            "insert into phases (flow_id, name, order_index, created_by) values (%s,%s,%s,%s) returning id",
            (flow_id, f"_smoke_reorder_{name}", i, admin_id),
        )
        phase_ids.append(cur.fetchone()[0])
    print("phases criadas:", phase_ids)

    # inverter ordem
    new_order = list(reversed(phase_ids))
    for i, pid in enumerate(new_order):
        as_user(
            admin_id,
            "update phases set order_index=%s where id=%s returning order_index",
            (i, pid),
        )
    cur.execute(
        "select name, order_index from phases where flow_id=%s and name like %s order by order_index",
        (flow_id, "_smoke_reorder_%"),
    )
    rows = cur.fetchall()
    print("phases depois:", rows)
    expected = [("_smoke_reorder_C", 0), ("_smoke_reorder_B", 1), ("_smoke_reorder_A", 2)]
    if rows == expected:
        print("2. reorder phases PASS")
    else:
        print("2. reorder phases FAIL: esperado", expected, "got", rows)
else:
    print("2. sem flow pra testar (skip)")

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE reorder: DONE ---")
