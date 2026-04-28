"""Smoke E2E phase_comments (flow_comments com phase_id) via psycopg+RLS.
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

ADMIN = "b751dd4e-78d3-425d-802e-b7d10c94ee72"
WS_ID = "11111111-1111-1111-1111-fabdfabdfabd"


def impersonate(uid):
    cur.execute("set local role authenticated;")
    cur.execute(f"set local request.jwt.claim.sub = '{uid}';")


try:
    impersonate(ADMIN)

    cur.execute(
        f"""
        insert into projects (directory_id, name, status, created_by)
        select d.id, 'P comm', 'active', '{ADMIN}'
        from directories d where d.slug = 'tecnica' and d.workspace_id = '{WS_ID}'
        returning id
        """
    )
    proj_id = cur.fetchone()[0]
    cur.execute(
        f"""
        insert into flows (project_id, name, type, status, created_by)
        values ('{proj_id}', 'F comm', 'non_continuous', 'active', '{ADMIN}')
        returning id
        """
    )
    flow_id = cur.fetchone()[0]
    cur.execute(
        f"""
        insert into phases (flow_id, name, order_index, created_by)
        values ('{flow_id}', 'Fase 1 comm', 0, '{ADMIN}')
        returning id
        """
    )
    phase_id = cur.fetchone()[0]

    # 1. comentario do FLUXO (phase_id NULL)
    cur.execute(
        f"""
        insert into flow_comments (flow_id, author_id, content)
        values ('{flow_id}', '{ADMIN}', 'comentario do fluxo inteiro')
        returning id
        """
    )
    flow_cmt_id = cur.fetchone()[0]
    print(f"1. flow comment PASS: {flow_cmt_id is not None}")

    # 2. comentario da FASE (phase_id setado)
    cur.execute(
        f"""
        insert into flow_comments (flow_id, phase_id, author_id, content)
        values ('{flow_id}', '{phase_id}', '{ADMIN}', 'comentario apenas da fase 1')
        returning id, phase_id
        """
    )
    row = cur.fetchone()
    phase_cmt_id, phase_cmt_phase_id = row
    print(f"2. phase comment PASS: {phase_cmt_phase_id == phase_id}")

    # 3. filtrar so comments da fase
    cur.execute(
        f"select content from flow_comments where flow_id = '{flow_id}' and phase_id = '{phase_id}'"
    )
    rows = cur.fetchall()
    print(f"3. filter by phase_id PASS: {len(rows) == 1 and 'apenas da fase 1' in rows[0][0]}")

    # 4. filtrar so comments do fluxo (phase_id null)
    cur.execute(
        f"select content from flow_comments where flow_id = '{flow_id}' and phase_id is null"
    )
    rows = cur.fetchall()
    print(f"4. filter flow-only PASS: {len(rows) == 1 and 'fluxo inteiro' in rows[0][0]}")

    conn.rollback()
    print("\nALL DONE — transacao rollbacked")
finally:
    cur.close()
    conn.close()
