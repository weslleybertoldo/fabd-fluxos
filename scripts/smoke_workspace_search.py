"""Smoke E2E find_workspace_by_id RPC + requestMembership flow.
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
    # Cria 2nd user que NAO eh member do FABD
    cur.execute("""
        insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, raw_app_meta_data, is_anonymous, is_sso_user)
        values (gen_random_uuid(), 'search-smoke@local', '', now(), '{"full_name":"Search Smoke"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, false, false)
        returning id
    """)
    other_uid = cur.fetchone()[0]
    print(f"setup: other_uid={other_uid}")

    # 1. Sem RPC, user-other faz select em workspaces — RLS deve retornar 0
    imp(other_uid)
    cur.execute(f"select id, name, slug from workspaces where id = '{WS_ID}'")
    rows_direct = cur.fetchall()
    print(f"1. select direto sem ser member: {len(rows_direct)} rows (esperado 0)")

    # 2. Via RPC find_workspace_by_id, user-other CONSEGUE descobrir workspace pelo id
    cur.execute(f"select * from find_workspace_by_id('{WS_ID}'::uuid)")
    rows_rpc = cur.fetchall()
    print(f"2. via RPC: {len(rows_rpc)} rows (esperado 1)")
    if rows_rpc:
        print(f"   nome: {rows_rpc[0][1]}, slug: {rows_rpc[0][2]}, status: {rows_rpc[0][3]}")
        assert rows_rpc[0][3] is None, f"member_status deveria ser null, veio {rows_rpc[0][3]}"

    # 3. UUID inexistente retorna 0 rows
    cur.execute("select * from find_workspace_by_id('00000000-0000-0000-0000-000000000000'::uuid)")
    rows_none = cur.fetchall()
    print(f"3. UUID inexistente: {len(rows_none)} rows (esperado 0)")

    # 4. Anonimo (sem auth) NAO consegue chamar (raise exception)
    cur.execute("reset role; reset request.jwt.claim.sub;")
    cur.execute("set local role authenticated;")  # sem JWT claim sub
    try:
        cur.execute(f"select * from find_workspace_by_id('{WS_ID}'::uuid)")
        rows_anon = cur.fetchall()
        print(f"4. sem JWT: NAO LANCOU exception ({len(rows_anon)} rows)")
    except psycopg2.errors.RaiseException as e:
        conn.rollback()
        print(f"4. sem JWT bloqueado PASS: {type(e).__name__}")
    except Exception as e:
        if "Nao autenticado" in str(e):
            conn.rollback()
            print(f"4. sem JWT bloqueado PASS")
        else:
            raise

    # Cleanup
    conn.rollback()
    print("\nALL DONE")
finally:
    cur.close()
    conn.close()
