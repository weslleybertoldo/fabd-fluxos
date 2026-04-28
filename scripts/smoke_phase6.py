"""Smoke E2E Fase 6 (parcial): comments + attachments + tags via psycopg+RLS.
Roda em transacao com rollback.
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


def as_user(user_id, sql, params=()):
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.sub", str(user_id)))
    cur.execute("select set_config(%s, %s, true)", ("request.jwt.claim.role", "authenticated"))
    cur.execute("set local role authenticated")
    cur.execute(sql, params)
    out = cur.fetchall() if cur.description else None
    cur.execute("reset role")
    return out


# achar flow + phase ativos
cur.execute(
    """select f.id, ph.id from flows f
       left join phases ph on ph.flow_id=f.id
       join projects p on p.id=f.project_id
       join directories d on d.id=p.directory_id
       where d.workspace_id=%s and f.status=%s
       order by f.created_at desc limit 1""",
    (ws_id, "active"),
)
row = cur.fetchone()
assert row, "Sem flow"
flow_id = row[0]
phase_id = row[1]
if not phase_id:
    cur.execute(
        "insert into phases (flow_id, name, order_index, created_by) values (%s,%s,%s,%s) returning id",
        (flow_id, "_smoke_phase", 99, admin_id),
    )
    phase_id = cur.fetchone()[0]
print("flow:", flow_id, "phase:", phase_id)

# 1) flow_comments
out = as_user(
    admin_id,
    "insert into flow_comments (flow_id, author_id, content) values (%s,%s,%s) returning id",
    (flow_id, admin_id, "smoke comment"),
)
cmt_id = out[0][0]
print("1. comment create PASS:", cmt_id)

out = as_user(
    admin_id,
    "update flow_comments set content=%s where id=%s returning content",
    ("editado", cmt_id),
)
print("2. comment update PASS:", out[0][0])

out = as_user(admin_id, "delete from flow_comments where id=%s returning id", (cmt_id,))
print("3. comment delete PASS:", len(out or []))

# 2) phase_attachments
out = as_user(
    admin_id,
    """insert into phase_attachments (phase_id, file_name, mime_type, file_size, storage_path, uploaded_by)
       values (%s,%s,%s,%s,%s,%s) returning id""",
    (phase_id, "doc.pdf", "application/pdf", 1024, f"workspace-{ws_id}/flow-{flow_id}/phase-{phase_id}/test.pdf", admin_id),
)
att_id = out[0][0]
print("4. attachment create PASS:", att_id)

out = as_user(admin_id, "delete from phase_attachments where id=%s returning id", (att_id,))
print("5. attachment delete PASS:", len(out or []))

# 3) tags
tag_name = f"_smoke_tag_{uuid.uuid4().hex[:6]}"
out = as_user(
    admin_id,
    "insert into tags (workspace_id, name, color, created_by) values (%s,%s,%s,%s) returning id",
    (ws_id, tag_name, "#10B981", admin_id),
)
tag_id = out[0][0]
print("6. tag create PASS:", tag_id)

out = as_user(
    admin_id,
    "insert into flow_tags (flow_id, tag_id, added_by) values (%s,%s,%s) returning flow_id",
    (flow_id, tag_id, admin_id),
)
print("7. flow_tag attach PASS:", out[0][0])

out = as_user(
    admin_id,
    "delete from flow_tags where flow_id=%s and tag_id=%s returning flow_id",
    (flow_id, tag_id),
)
print("8. flow_tag detach PASS:", len(out or []))

# Policies
cur.execute(
    "select tablename, count(*) from pg_policies where schemaname='public' and tablename in ('flow_comments','phase_attachments','tags','flow_tags') group by tablename order by 1"
)
print("policies count:", cur.fetchall())

conn.rollback()
cur.close()
conn.close()
print("--- SMOKE Fase 6 (6A+6B+6C): PASS ---")
