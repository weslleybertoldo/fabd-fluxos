"""Smoke E2E do cron de notify-due-phases.
Cria phase com due_date passado, hita o endpoint, valida que notification foi
criada na tabela. Roda em transacao com rollback (mas precisa commitar antes
de chamar HTTP, entao no fim faz cleanup explicito).
"""
import os
import urllib.request
import json
import psycopg2

PASSWORD = os.environ.get("FABD_FLUXOS_DB_PASSWORD")
SECRET = os.environ.get("CRON_SECRET")
assert PASSWORD and SECRET, "set FABD_FLUXOS_DB_PASSWORD e CRON_SECRET"

ADMIN = "b751dd4e-78d3-425d-802e-b7d10c94ee72"
WS_ID = "11111111-1111-1111-1111-fabdfabdfabd"

conn = psycopg2.connect(
    host="db.nexvflddmubtcizervda.supabase.co",
    port=5432, user="postgres", password=PASSWORD, dbname="postgres",
)
cur = conn.cursor()

created = {}
try:
    # Cria user fake usado SO como responsible no smoke. Email inexistente
    # `smoke-fake@local` evita poluir o inbox do admin real toda vez que rodar.
    cur.execute("""
        insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, raw_app_meta_data, is_anonymous, is_sso_user)
        values (gen_random_uuid(), 'smoke-fake@local', '', now(), '{"full_name":"Smoke Fake"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, false, false)
        returning id
    """)
    fake_uid = cur.fetchone()[0]
    created["fake_user"] = fake_uid
    cur.execute(
        f"""
        insert into workspace_members (workspace_id, user_id, role, status, approved_at, approved_by, google_full_name, google_email)
        values ('{WS_ID}', '{fake_uid}', 'membro', 'active', now(), '{ADMIN}', 'Smoke Fake', 'smoke-fake@local')
        """
    )

    cur.execute(
        f"""
        insert into projects (directory_id, name, status, created_by, responsible_user_id)
        select d.id, 'CRON SMOKE proj', 'active', '{ADMIN}', '{fake_uid}'
        from directories d where d.slug = 'tecnica' and d.workspace_id = '{WS_ID}'
        returning id
        """
    )
    proj_id = cur.fetchone()[0]
    created["project"] = proj_id

    cur.execute(
        f"""
        insert into flows (project_id, name, type, status, created_by)
        values ('{proj_id}', 'CRON SMOKE flow', 'non_continuous', 'active', '{ADMIN}')
        returning id
        """
    )
    flow_id = cur.fetchone()[0]
    created["flow"] = flow_id

    # Phase vencida: due_date 2 dias atras
    cur.execute(
        f"""
        insert into phases (flow_id, name, due_date, order_index, created_by)
        values ('{flow_id}', 'CRON SMOKE phase atrasada', now() - interval '2 days', 0, '{ADMIN}')
        returning id
        """
    )
    phase_id = cur.fetchone()[0]
    created["phase"] = phase_id

    conn.commit()
    print(f"Setup: phase {phase_id} (due 2 dias atras, project resp = fake_uid {fake_uid})")

    # Hit endpoint
    req = urllib.request.Request(
        "https://fluxos.fabd.com.br/api/cron/notify-due-phases",
        method="POST",
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode())
        print(f"endpoint resp: {body}")
        assert body.get("ok") is True, f"endpoint nao retornou ok: {body}"
        assert body.get("sent", 0) >= 1, f"nada foi enviado: {body}"

    # Validar que notification foi criada PRO USER FAKE (nao admin real)
    cur.execute(
        f"""
        select type, title, link from notifications
        where entity = 'phase' and entity_id = '{phase_id}' and user_id = '{fake_uid}'
        """
    )
    notif_rows = cur.fetchall()
    print(f"notifications criadas: {len(notif_rows)}")
    assert len(notif_rows) >= 1, "nenhuma notification gerada"
    print(f"notif: type={notif_rows[0][0]}, title={notif_rows[0][1][:60]}")
    assert notif_rows[0][0] == "phase_overdue", f"tipo errado: {notif_rows[0][0]}"

    # Validar dedup: chamar endpoint de novo, nao deve mandar mais
    with urllib.request.urlopen(req, timeout=60) as resp:
        body2 = json.loads(resp.read().decode())
        print(f"endpoint 2a chamada: {body2}")
        assert body2.get("skipped", 0) >= 1, f"dedup nao funcionou: {body2}"

    # Validar log
    cur.execute(
        f"select notification_type, notification_day from phase_notification_log where phase_id = '{phase_id}' and user_id = '{fake_uid}'"
    )
    log = cur.fetchall()
    print(f"log entries: {len(log)} (esperado 1) — {log}")
    assert len(log) == 1, "log nao tem exatamente 1 entrada"

    print("\nALL PASS")
finally:
    # Cleanup
    if "phase" in created:
        cur.execute(f"delete from notifications where entity_id = '{created['phase']}'")
        cur.execute(f"delete from phase_notification_log where phase_id = '{created['phase']}'")
    if "flow" in created:
        cur.execute(f"delete from flows where id = '{created['flow']}'")
    if "project" in created:
        cur.execute(f"delete from projects where id = '{created['project']}'")
    if "fake_user" in created:
        # CASCADE remove workspace_member + phase_responsibles + qualquer
        # other notification que tenha vazado
        cur.execute(f"delete from auth.users where id = '{created['fake_user']}'")
    conn.commit()
    cur.close()
    conn.close()
    print("cleanup OK")
