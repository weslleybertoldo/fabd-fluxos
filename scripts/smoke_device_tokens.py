"""Smoke E2E device_tokens RLS via psycopg.
Roda em transacao com rollback.
"""
import os
import psycopg2

PASSWORD = os.environ.get("FABD_FLUXOS_DB_PASSWORD")
assert PASSWORD, "set FABD_FLUXOS_DB_PASSWORD"

ADMIN = "b751dd4e-78d3-425d-802e-b7d10c94ee72"

conn = psycopg2.connect(
    host="db.nexvflddmubtcizervda.supabase.co",
    port=5432, user="postgres", password=PASSWORD, dbname="postgres",
)
cur = conn.cursor()

try:
    # Cria 2 users
    cur.execute("""
        insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, raw_app_meta_data, is_anonymous, is_sso_user)
        values (gen_random_uuid(), 'fcm-a@local', '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, false, false)
        returning id
    """)
    a = cur.fetchone()[0]
    cur.execute("""
        insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, raw_app_meta_data, is_anonymous, is_sso_user)
        values (gen_random_uuid(), 'fcm-b@local', '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, false, false)
        returning id
    """)
    b = cur.fetchone()[0]

    # 1. user A insere proprio token
    cur.execute('set local role authenticated;')
    cur.execute(f"set local request.jwt.claim.sub = '{a}';")
    cur.execute(f"insert into device_tokens (user_id, token, platform) values ('{a}', 'tokA-fake-fcm-001', 'android')")
    print(f"1. user A insere proprio token PASS")

    # 2. user A NAO consegue inserir pra outro user (B). Usa savepoint pra
    # nao perder o setup quando RLS abortar a transacao
    cur.execute("savepoint try_violate")
    try:
        cur.execute(f"insert into device_tokens (user_id, token, platform) values ('{b}', 'fake-impersonating-B', 'android')")
        print("2. user A inseriu pra B (BUG): FALHA")
    except Exception as e:
        if "row-level security" in str(e).lower() or "violates" in str(e).lower() or "insufficient" in str(e).lower():
            cur.execute("rollback to savepoint try_violate")
            print(f"2. user A bloqueado (impersonation B) PASS: {type(e).__name__}")
        else:
            raise

    cur.execute(f"insert into device_tokens (user_id, token, platform) values ('{a}', 'tokA-fake-002', 'android')")

    # 3. user A so ve seus tokens
    cur.execute("select count(*) from device_tokens")
    n_a = cur.fetchone()[0]
    print(f"3. user A select count: {n_a} (esperado >=1, somente seus)")

    # 4. user B nao ve nada
    cur.execute('set local role authenticated;')
    cur.execute(f"set local request.jwt.claim.sub = '{b}';")
    cur.execute("select count(*) from device_tokens")
    n_b = cur.fetchone()[0]
    print(f"4. user B select count: {n_b} (esperado 0 — RLS isola)")

    conn.rollback()
    print("\nALL DONE")
finally:
    cur.close()
    conn.close()
