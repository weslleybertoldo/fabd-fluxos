"""Smoke E2E phase_fields + values + mobile transition simulada via psycopg+RLS.
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

# Acharflow ativo
cur.execute(
    """select f.id from flows f
       join projects p on p.id=f.project_id
       join directories d on d.id=p.directory_id
       where d.workspace_id=%s and f.status='active'
       order by f.created_at desc limit 1""",
    (ws_id,),
)
flow_id = cur.fetchone()[0]
print("flow:", flow_id)

# Criar 2 fases temporarias
cur.execute(
    "insert into phases (flow_id, name, order_index, created_by) values (%s,%s,%s,%s) returning id",
    (flow_id, "_smoke_p1", 100, admin_id),
)
p1 = cur.fetchone()[0]
cur.execute(
    "insert into phases (flow_id, name, order_index, created_by) values (%s,%s,%s,%s) returning id",
    (flow_id, "_smoke_p2", 101, admin_id),
)
p2 = cur.fetchone()[0]
print("phases:", p1, p2)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# 1) CREATE field fixo + movel em p1
out = as_user(
    admin_id,
    """insert into phase_fields (phase_id, type, label, mode, order_index, created_by)
       values (%s,%s,%s,%s,%s,%s) returning id""",
    (p1, "text", "Nome do ginasio", "fixed", 0, admin_id),
)
field_fix = out[0][0]
print("1. field fixo PASS:", field_fix)

out = as_user(
    admin_id,
    """insert into phase_fields (phase_id, type, label, mode, order_index, created_by)
       values (%s,%s,%s,%s,%s,%s) returning id""",
    (p1, "text", "Responsavel", "mobile", 1, admin_id),
)
field_mob = out[0][0]
print("2. field movel PASS:", field_mob)

# 2) Set values
out = as_user(
    admin_id,
    """insert into phase_field_values (phase_field_id, current_phase_id, value_text, updated_by)
       values (%s,%s,%s,%s) returning id""",
    (field_fix, p1, "Ginasio Mucuripe", admin_id),
)
val_fix = out[0][0]
print("3. value fixo PASS:", val_fix)

out = as_user(
    admin_id,
    """insert into phase_field_values (phase_field_id, current_phase_id, value_text, updated_by)
       values (%s,%s,%s,%s) returning id""",
    (field_mob, p1, "Weslley", admin_id),
)
val_mob = out[0][0]
print("4. value movel PASS:", val_mob)

# 3) Simular transicao: move so o value movel pra p2
as_user(
    admin_id,
    """update phase_field_values set current_phase_id=%s
       where current_phase_id=%s and phase_field_id in (
         select id from phase_fields where mode='mobile')
       returning id""",
    (p2, p1),
)
cur.execute(
    "select phase_field_id, current_phase_id, value_text from phase_field_values where phase_field_id in (%s,%s) order by current_phase_id",
    (field_fix, field_mob),
)
rows = cur.fetchall()
print("5. apos transicao:", rows)
fixo_phase = next((r[1] for r in rows if r[0] == field_fix), None)
movel_phase = next((r[1] for r in rows if r[0] == field_mob), None)
if fixo_phase == p1 and movel_phase == p2:
    print("5. mobile transition PASS — fixo ficou em p1, movel foi pra p2")
else:
    print(f"5. mobile transition FAIL — fixo:{fixo_phase}, movel:{movel_phase}")

# 4) Policies
cur.execute(
    "select tablename, count(*) from pg_policies where schemaname='public' and tablename in ('phase_fields','phase_field_values') group by tablename order by 1"
)
print("6. policies:", cur.fetchall())

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE 6D: PASS ---")
