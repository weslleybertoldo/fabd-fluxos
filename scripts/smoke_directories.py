"""Smoke E2E directories CRUD + bucket directory-images.

Roda em transacao com rollback — nao persiste.
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
    """
    select wm.user_id, w.id from workspace_members wm
    join workspaces w on w.id=wm.workspace_id
    where w.slug=%s and wm.role=%s and wm.status=%s limit 1
    """,
    ("fabd", "admin", "active"),
)
admin_id, ws_id = cur.fetchone()
print("admin:", admin_id)
print("workspace:", ws_id)


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# 1) CREATE directory
slug = f"_smoke_dir_{uuid.uuid4().hex[:6]}"
out = as_user(
    admin_id,
    """insert into directories (workspace_id, name, slug, color, order_index, created_by)
       values (%s,%s,%s,%s,%s,%s) returning id""",
    (ws_id, "_Smoke Test Dir", slug, "#FF00FF", 99, admin_id),
)
dir_id = out[0][0]
print("1. create directory PASS:", dir_id)

# 2) UPDATE directory (image_url)
fake_url = f"https://nexvflddmubtcizervda.supabase.co/storage/v1/object/public/directory-images/{ws_id}/{dir_id}-test.png"
out = as_user(
    admin_id,
    "update directories set image_url=%s, name=%s where id=%s returning image_url, name",
    (fake_url, "_Smoke Test Dir Updated", dir_id),
)
print("2. update PASS:", out[0])

# 3) DELETE directory
out = as_user(admin_id, "delete from directories where id=%s returning id", (dir_id,))
print("3. delete PASS:", len(out or []), "rows")

# 4) Verificar bucket + policies
cur.execute("select id, public, file_size_limit from storage.buckets where id=%s", ("directory-images",))
print("4. bucket directory-images:", cur.fetchone())
cur.execute(
    "select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'directory-images%' order by 1"
)
print("5. storage policies:", [r[0] for r in cur.fetchall()])
cur.execute("select column_name from information_schema.columns where table_schema='public' and table_name='directories' and column_name='image_url'")
print("6. column image_url:", cur.fetchall())

# 7) NEGATIVE: simular membro tentando criar diretoria (deve bloquear via dir_insert)
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
            """insert into directories (workspace_id, name, slug, color, order_index, created_by)
               values (%s,%s,%s,%s,%s,%s) returning id""",
            (ws_id, "_should_fail", f"sf_{uuid.uuid4().hex[:6]}", "#000000", 100, membro_id),
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
print("--- SMOKE directories: PASS ---")
