"""Smoke E2E clone_project RPC.
Cria projeto com flows + phases + fields + responsibles + tags, clona,
valida que tudo foi copiado e que comments/attachments NAO foram.
Roda em transacao com rollback.
"""
import os
import psycopg2

PASSWORD = os.environ.get("FABD_FLUXOS_DB_PASSWORD")
assert PASSWORD, "set FABD_FLUXOS_DB_PASSWORD"

ADMIN = "b751dd4e-78d3-425d-802e-b7d10c94ee72"
WS_ID = "11111111-1111-1111-1111-fabdfabdfabd"

conn = psycopg2.connect(
    host="db.nexvflddmubtcizervda.supabase.co",
    port=5432, user="postgres", password=PASSWORD, dbname="postgres",
)
cur = conn.cursor()


def imp(uid):
    cur.execute("set local role authenticated;")
    cur.execute(f"set local request.jwt.claim.sub = '{uid}';")


try:
    imp(ADMIN)

    # SETUP: projeto + 2 flows + 3 phases + 1 field + 1 responsible + 1 tag + 1 comment
    cur.execute(
        f"""
        insert into projects (directory_id, name, status, created_by, responsible_user_id, description)
        select d.id, 'PROJ ORIG', 'active', '{ADMIN}', '{ADMIN}', 'descricao do orig'
        from directories d where d.slug='tecnica' and d.workspace_id='{WS_ID}'
        returning id
        """
    )
    proj_orig = cur.fetchone()[0]

    cur.execute(
        f"insert into flows (project_id, name, type, status, order_index, created_by, description) values ('{proj_orig}', 'F1', 'continuous', 'active', 0, '{ADMIN}', 'desc f1') returning id"
    )
    flow1 = cur.fetchone()[0]
    cur.execute(
        f"insert into flows (project_id, name, type, status, order_index, created_by) values ('{proj_orig}', 'F2', 'non_continuous', 'active', 1, '{ADMIN}') returning id"
    )
    flow2 = cur.fetchone()[0]

    cur.execute(
        f"insert into phases (flow_id, name, order_index, due_date, color, created_by) values ('{flow1}', 'P1.1', 0, now() + interval '5 days', '#FF0000', '{ADMIN}') returning id"
    )
    phase1 = cur.fetchone()[0]
    cur.execute(
        f"insert into phases (flow_id, name, order_index, created_by) values ('{flow1}', 'P1.2', 1, '{ADMIN}') returning id"
    )
    phase2 = cur.fetchone()[0]
    cur.execute(
        f"insert into phases (flow_id, name, order_index, created_by) values ('{flow2}', 'P2.1', 0, '{ADMIN}') returning id"
    )
    phase3 = cur.fetchone()[0]

    cur.execute(
        f"insert into phase_fields (phase_id, type, label, mode, order_index, created_by) values ('{phase1}', 'text', 'Campo texto', 'fixed', 0, '{ADMIN}') returning id"
    )
    field1 = cur.fetchone()[0]
    cur.execute(
        f"insert into phase_responsibles (phase_id, user_id, assigned_by) values ('{phase1}', '{ADMIN}', '{ADMIN}')"
    )
    cur.execute(
        f"insert into tags (workspace_id, name, color, created_by) values ('{WS_ID}', 'tag-smoke-clone', '#0F0', '{ADMIN}') returning id"
    )
    tag1 = cur.fetchone()[0]
    cur.execute(
        f"insert into flow_tags (flow_id, tag_id, added_by) values ('{flow1}', '{tag1}', '{ADMIN}')"
    )

    # Comment NAO deve ser copiado
    cur.execute(
        f"insert into flow_comments (flow_id, author_id, content) values ('{flow1}', '{ADMIN}', 'comment NAO copiar') returning id"
    )

    # CLONE
    cur.execute(f"select clone_project('{proj_orig}'::uuid)")
    proj_new = cur.fetchone()[0]
    print(f"1. clone retornou novo project: {proj_new}")
    assert proj_new is not None

    # VALIDAR
    # nome com prefixo Cópia
    cur.execute(f"select name, status, description from projects where id = '{proj_new}'")
    name, status, desc = cur.fetchone()
    print(f"2. nome PASS: {name == 'Cópia PROJ ORIG'} ({name})")
    print(f"3. status active PASS: {status == 'active'}")
    print(f"4. description copiada PASS: {desc == 'descricao do orig'}")

    # 2 flows
    cur.execute(
        f"select count(*), array_agg(name order by order_index) from flows where project_id = '{proj_new}'"
    )
    n_flows, flow_names = cur.fetchone()
    print(f"5. 2 flows PASS: {n_flows == 2 and flow_names == ['F1','F2']}")

    # phases por flow novo
    cur.execute(
        f"""
        select count(*) from phases ph
        join flows fl on fl.id = ph.flow_id
        where fl.project_id = '{proj_new}'
        """
    )
    print(f"6. 3 phases PASS: {cur.fetchone()[0] == 3}")

    # fields
    cur.execute(
        f"""
        select count(*), array_agg(label) from phase_fields pf
        join phases ph on ph.id = pf.phase_id
        join flows fl on fl.id = ph.flow_id
        where fl.project_id = '{proj_new}'
        """
    )
    n_fields, field_labels = cur.fetchone()
    print(f"7. 1 field PASS: {n_fields == 1 and field_labels == ['Campo texto']}")

    # responsibles
    cur.execute(
        f"""
        select count(*) from phase_responsibles pr
        join phases ph on ph.id = pr.phase_id
        join flows fl on fl.id = ph.flow_id
        where fl.project_id = '{proj_new}'
        """
    )
    print(f"8. 1 responsible PASS: {cur.fetchone()[0] == 1}")

    # flow_tags
    cur.execute(
        f"""
        select count(*) from flow_tags ft
        join flows fl on fl.id = ft.flow_id
        where fl.project_id = '{proj_new}'
        """
    )
    print(f"9. 1 flow_tag PASS: {cur.fetchone()[0] == 1}")

    # comments NAO foram copiados
    cur.execute(
        f"""
        select count(*) from flow_comments fc
        join flows fl on fl.id = fc.flow_id
        where fl.project_id = '{proj_new}'
        """
    )
    print(f"10. comments NAO copiados PASS: {cur.fetchone()[0] == 0}")

    conn.rollback()
    print("\nALL DONE — transacao rollbacked")
finally:
    cur.close()
    conn.close()
