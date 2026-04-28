"""Smoke E2E phase_responsibles via psycopg+RLS.
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
    # cria 2nd user "membro" só pro teste
    cur.execute("""
        insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, raw_app_meta_data, is_anonymous, is_sso_user)
        values (gen_random_uuid(), 'smoke-resp@local', '', now(), '{"full_name":"Smoke Resp"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, false, false)
        returning id
    """)
    member_id = cur.fetchone()[0]
    cur.execute(
        f"""
        insert into workspace_members (workspace_id, user_id, role, status, approved_at, approved_by, google_full_name)
        values ('{WS_ID}', '{member_id}', 'membro', 'active', now(), '{ADMIN}', 'Smoke Resp')
        """
    )

    # admin cria projeto+fluxo+fase
    impersonate(ADMIN)
    cur.execute(
        f"""
        insert into projects (directory_id, name, status, created_by)
        select d.id, 'P resp', 'active', '{ADMIN}'
        from directories d where d.slug = 'tecnica' and d.workspace_id = '{WS_ID}'
        returning id
        """
    )
    proj_id = cur.fetchone()[0]
    cur.execute(
        f"""
        insert into flows (project_id, name, type, status, created_by)
        values ('{proj_id}', 'F resp', 'non_continuous', 'active', '{ADMIN}')
        returning id
        """
    )
    flow_id = cur.fetchone()[0]
    cur.execute(
        f"""
        insert into phases (flow_id, name, order_index, created_by)
        values ('{flow_id}', 'Fase 1 resp', 0, '{ADMIN}')
        returning id
        """
    )
    phase_id = cur.fetchone()[0]
    print(f"phase: {phase_id}")

    # 1. admin atribui member como responsavel
    cur.execute(
        f"""
        insert into phase_responsibles (phase_id, user_id, assigned_by)
        values ('{phase_id}', '{member_id}', '{ADMIN}')
        """
    )
    cur.execute(f"select count(*) from phase_responsibles where phase_id = '{phase_id}'")
    n = cur.fetchone()[0]
    print(f"1. add responsible PASS: {n == 1}")

    # 2. member ve o phase_responsible (pr_select: is_workspace_member)
    impersonate(member_id)
    cur.execute(f"select user_id from phase_responsibles where phase_id = '{phase_id}'")
    rows = cur.fetchall()
    print(f"2. member ve responsibles PASS: {len(rows) == 1 and rows[0][0] == member_id}")

    # 3. member NAO consegue inserir (pr_insert: can_edit_phase, exige admin OR diretor que criou flow)
    try:
        cur.execute(
            f"""
            insert into phase_responsibles (phase_id, user_id, assigned_by)
            values ('{phase_id}', '{ADMIN}', '{member_id}')
            """
        )
        print("3. member NAO deveria poder inserir PASS: False")
    except psycopg2.errors.InsufficientPrivilege:
        conn.rollback()
        print("3. member bloqueado pela RLS PASS: True (insufficient_privilege)")
    except Exception as e:
        if "row-level security" in str(e).lower() or "violates" in str(e).lower():
            conn.rollback()
            print(f"3. member bloqueado pela RLS PASS: True ({type(e).__name__})")
        else:
            raise

    # rollback final pra nao deixar nada
    conn.rollback()
    print("\nALL DONE — transacao rollbacked")
finally:
    cur.close()
    conn.close()
