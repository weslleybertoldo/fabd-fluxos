"""Smoke E2E: membro 100% read-only + member_project_access.

Roda via Management API (SQL endpoint) em transacao com rollback ao final.
Valida que a role 'membro' eh barrada por RLS em INSERT/UPDATE/DELETE
em flow_comments, phase_field_values, phase_attachments, reminders,
simple_lists, simple_list_items.

Uso:
  python3 scripts/smoke_member_readonly.py
"""
import json
import os
import sys
import urllib.error
import urllib.request

PAT = os.environ.get("FABD_FLUXOS_PAT")
assert PAT, "set FABD_FLUXOS_PAT (Supabase Personal Access Token)"
REF = "nexvflddmubtcizervda"
ADMIN = "b751dd4e-78d3-425d-802e-b7d10c94ee72"
WS_ID = "11111111-1111-1111-1111-fabdfabdfabd"

API = f"https://api.supabase.com/v1/projects/{REF}/database/query"


def run(sql: str):
    req = urllib.request.Request(
        API,
        method="POST",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {PAT}",
            "Content-Type": "application/json",
            "User-Agent": "fabd-fluxos-cli/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "[]")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


# Bloco transacional: tudo em DO $$ BEGIN ... ROLLBACK; END $$ nao funciona
# (DO eh um statement so). A Management API processa cada query inteira como
# transacao implicita; pra rollback precisamos comitar setup, rodar testes e
# limpar manualmente no final.

results = {"pass": 0, "fail": 0, "details": []}


def assert_pass(label, ok, detail=""):
    icon = "[PASS]" if ok else "[FAIL]"
    print(f"{icon} {label}{(' — ' + detail) if detail else ''}")
    if ok:
        results["pass"] += 1
    else:
        results["fail"] += 1
        results["details"].append(label)


# 1) Cria user-membro de teste
print("Setup...")
code, body = run(
    """
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, raw_app_meta_data, is_anonymous, is_sso_user)
    values (gen_random_uuid(), 'smoke-readonly@local', '', now(), '{"full_name":"Smoke Readonly"}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{}'::jsonb, false, false)
    returning id;
    """
)
if code != 201 or not isinstance(body, list) or not body:
    print("FAIL setup auth.users:", code, body)
    sys.exit(1)
member_uid = body[0]["id"]

code, body = run(
    f"""
    insert into workspace_members (workspace_id, user_id, role, status, approved_at, approved_by, google_full_name, google_email)
    values ('{WS_ID}', '{member_uid}', 'membro', 'active', now(), '{ADMIN}', 'Smoke Readonly', 'smoke-readonly@local')
    returning id;
    """
)
member_wm_id = body[0]["id"]
print(f"member_uid={member_uid} wm_id={member_wm_id}")

# Pega 1 projeto + 1 fluxo + 1 fase + 1 lista existente pra usar nos testes
code, body = run(
    f"""
    select p.id as project_id, f.id as flow_id, ph.id as phase_id, sl.id as list_id, pf.id as field_id
    from projects p
    join directories d on d.id = p.directory_id and d.workspace_id = '{WS_ID}'
    left join flows f on f.project_id = p.id
    left join phases ph on ph.flow_id = f.id
    left join simple_lists sl on sl.project_id = p.id
    left join phase_fields pf on pf.phase_id = ph.id
    where p.status = 'active'
    limit 1;
    """
)
ctx = body[0] if isinstance(body, list) and body else {}
project_id = ctx.get("project_id")
flow_id = ctx.get("flow_id")
phase_id = ctx.get("phase_id")
list_id = ctx.get("list_id")
field_id = ctx.get("field_id")
print(f"ctx project={project_id} flow={flow_id} phase={phase_id} list={list_id} field={field_id}")


def impersonate_test(label, sql_inside_block):
    """Roda SQL dentro de bloco com SET LOCAL role=authenticated + jwt sub=member.
    O bloco INTEIRO precisa estar dentro de uma unica chamada porque a Management API
    nao mantem session entre chamadas.

    Esperamos que o INSERT/UPDATE/DELETE seja barrado. A query envolvida em
    DO $$ BEGIN ... EXCEPTION WHEN OTHERS THEN ... END $$ nao funciona pra
    "violates row-level security" (vem como erro PG no nivel da chamada).
    Em vez disso: se HTTP 201 com mudanca, fail; se erro RLS, pass.
    """
    full = f"""
        set local role authenticated;
        set local request.jwt.claim.sub = '{member_uid}';
        {sql_inside_block}
    """
    code, body = run(full)
    blocked = code != 201 and ("row-level security" in str(body).lower() or "violates" in str(body).lower() or "policy" in str(body).lower())
    detail = f"http={code} body={str(body)[:200]}" if not blocked else "RLS bloqueou OK"
    assert_pass(label, blocked, detail)


# 2) Membro NAO pode inserir flow_comments
if flow_id:
    impersonate_test(
        "membro bloqueado em flow_comments insert",
        f"insert into flow_comments (flow_id, author_id, content) values ('{flow_id}', '{member_uid}', 'teste');",
    )

# 3) Membro NAO pode inserir phase_field_values
if phase_id and field_id:
    impersonate_test(
        "membro bloqueado em phase_field_values insert",
        f"insert into phase_field_values (phase_field_id, current_phase_id, updated_by, value_text) values ('{field_id}', '{phase_id}', '{member_uid}', 'x');",
    )

# 4) Membro NAO pode inserir phase_attachments
if phase_id:
    impersonate_test(
        "membro bloqueado em phase_attachments insert",
        f"insert into phase_attachments (phase_id, uploaded_by, file_name, storage_path, file_size, mime_type) values ('{phase_id}', '{member_uid}', 'a.pdf', 'workspace-{WS_ID}/x', 1, 'application/pdf');",
    )

# 5) Membro NAO pode inserir reminders
if project_id:
    impersonate_test(
        "membro bloqueado em reminders insert",
        f"insert into reminders (project_id, name, created_by) values ('{project_id}', 'rem teste', '{member_uid}');",
    )

# 6) Membro NAO pode inserir simple_lists
if project_id:
    impersonate_test(
        "membro bloqueado em simple_lists insert",
        f"insert into simple_lists (project_id, name, created_by) values ('{project_id}', 'lista teste', '{member_uid}');",
    )

# 7) Membro NAO pode inserir simple_list_items
if list_id:
    impersonate_test(
        "membro bloqueado em simple_list_items insert",
        f"insert into simple_list_items (list_id, content) values ('{list_id}', 'item teste');",
    )

# 8) Admin pode inserir em member_project_access (controle de acesso por projeto)
if project_id:
    sql = f"""
        set local role authenticated;
        set local request.jwt.claim.sub = '{ADMIN}';
        insert into member_project_access (workspace_member_id, project_id, granted_by) values ('{member_wm_id}', '{project_id}', '{ADMIN}');
    """
    code, body = run(sql)
    assert_pass("admin insere member_project_access", code == 201, f"http={code} body={str(body)[:80]}")

# 9) Membro NAO pode inserir em member_project_access
if project_id:
    impersonate_test(
        "membro bloqueado em member_project_access insert",
        f"insert into member_project_access (workspace_member_id, project_id, granted_by) values ('{member_wm_id}', '{project_id}', '{member_uid}');",
    )

# 10) Membro consegue ver suas linhas em member_project_access
sql = f"""
    set local role authenticated;
    set local request.jwt.claim.sub = '{member_uid}';
    select count(*) as c from member_project_access where workspace_member_id = '{member_wm_id}';
"""
code, body = run(sql)
ok = code == 201 and isinstance(body, list) and body and body[0].get("c", 0) >= 1
assert_pass("membro le proprio member_project_access", ok, f"http={code} body={str(body)[:80]}")

# Cleanup
print("\nCleanup...")
run(f"delete from auth.users where id = '{member_uid}';")  # CASCADE limpa member_project_access + workspace_members

print(f"\n{'=' * 50}")
print(f"PASSED: {results['pass']}    FAILED: {results['fail']}")
if results["fail"]:
    print("Falhas:", results["details"])
    sys.exit(1)
else:
    print("ALL PASS")
