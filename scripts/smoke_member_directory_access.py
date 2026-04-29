"""Smoke E2E member_directory_access + show_reports via psycopg+RLS.
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


def impersonate(uid):
    cur.execute("set local role authenticated;")
    cur.execute(f"set local request.jwt.claim.sub = '{uid}';")


try:
    # Cria 2nd user 'membro'
    cur.execute("""
        insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, raw_app_meta_data, is_anonymous, is_sso_user)
        values (gen_random_uuid(), 'mda-smoke@local', '', now(), '{"full_name":"MDA Smoke"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, false, false)
        returning id
    """)
    member_uid = cur.fetchone()[0]
    cur.execute(
        f"""
        insert into workspace_members (workspace_id, user_id, role, status, approved_at, approved_by, google_full_name, google_email)
        values ('{WS_ID}', '{member_uid}', 'membro', 'active', now(), '{ADMIN}', 'MDA Smoke', 'mda-smoke@local')
        returning id
        """
    )
    member_wm_id = cur.fetchone()[0]
    print(f"setup: member_wm_id={member_wm_id}")

    # Pega 2 diretorias
    cur.execute(f"select id, slug from directories where workspace_id = '{WS_ID}' order by order_index limit 2")
    rows = cur.fetchall()
    dir1_id, dir1_slug = rows[0]
    dir2_id, dir2_slug = rows[1]

    # 1. Admin atribui acesso a 1 diretoria
    impersonate(ADMIN)
    cur.execute(
        f"insert into member_directory_access (workspace_member_id, directory_id, granted_by) values ('{member_wm_id}', '{dir1_id}', '{ADMIN}')"
    )
    cur.execute(f"select count(*) from member_directory_access where workspace_member_id = '{member_wm_id}'")
    print(f"1. admin attribui acesso PASS: {cur.fetchone()[0] == 1}")

    # 2. Member ve seu proprio acesso (mda_select)
    impersonate(member_uid)
    cur.execute(f"select directory_id from member_directory_access where workspace_member_id = '{member_wm_id}'")
    rows = cur.fetchall()
    print(f"2. member ve proprio acesso PASS: {len(rows) == 1 and rows[0][0] == dir1_id}")

    # 3. Member NAO consegue inserir/editar (mda_insert/mda_delete: so admin)
    try:
        cur.execute(
            f"insert into member_directory_access (workspace_member_id, directory_id, granted_by) values ('{member_wm_id}', '{dir2_id}', '{member_uid}')"
        )
        print("3. member NAO deveria poder inserir PASS: False")
    except Exception as e:
        if "row-level security" in str(e).lower() or "violates" in str(e).lower() or "insufficient" in str(e).lower():
            conn.rollback()
            print(f"3. member bloqueado pela RLS PASS: True ({type(e).__name__})")
        else:
            raise

    # 4. show_reports default = true (sem RLS — postgres user)
    cur.execute("reset role; reset request.jwt.claim.sub;")
    cur.execute(f"select show_reports from directories where id = '{dir1_id}'")
    print(f"4. show_reports default true PASS: {cur.fetchone()[0] is True}")

    # 5. Toggle off
    cur.execute(f"update directories set show_reports = false where id = '{dir1_id}'")
    cur.execute(f"select show_reports from directories where id = '{dir1_id}'")
    print(f"5. show_reports toggle off PASS: {cur.fetchone()[0] is False}")

    conn.rollback()
    print("\nALL DONE — transacao rollbacked")
finally:
    cur.close()
    conn.close()
