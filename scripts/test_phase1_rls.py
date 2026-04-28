"""
Validacao E2E Fase 1 — schema + RLS + audit_log
Roda 20 cenarios cobrindo admin / diretor / membro.

Pre-requisito: schema aplicado via 20260428000000_initial_schema.sql + 20260428000001_storage.sql

Uso:
    python scripts/test_phase1_rls.py

Saida: PASS / FAIL por cenario. Exit code 0 se tudo passou, 1 se algum falhou.
"""

import os
import sys
import json
import uuid
import time
import requests

SUPABASE_URL = "https://nexvflddmubtcizervda.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5leHZmbGRkbXVidGNpemVydmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczOTYyODMsImV4cCI6MjA5Mjk3MjI4M30.a6OUNyfJpyGoiRRU1QG0P-1-3RftDhWXiJsPEjgOFoM"
SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5leHZmbGRkbXVidGNpemVydmRhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM5NjI4MywiZXhwIjoyMDkyOTcyMjgzfQ.n3s27qJSJT8gDGAJODa_lY0V8VeW_Wy54vlpGoghYNE"

results = {"pass": 0, "fail": 0, "errors": []}


def log(label, passed, detail=""):
    icon = "[PASS]" if passed else "[FAIL]"
    print(f"{icon} {label}{(' — ' + detail) if detail else ''}")
    if passed:
        results["pass"] += 1
    else:
        results["fail"] += 1
        results["errors"].append(f"{label}: {detail}")


def admin_create_user(email, password):
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers={
            "apikey": SERVICE_ROLE,
            "Authorization": f"Bearer {SERVICE_ROLE}",
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password, "email_confirm": True},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["id"]


def admin_delete_user(user_id):
    requests.delete(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={"apikey": SERVICE_ROLE, "Authorization": f"Bearer {SERVICE_ROLE}"},
        timeout=10,
    )


def signin(email, password):
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def rest(method, path, token, body=None, params=None, expected_status=None):
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    r = requests.request(
        method, url, headers=headers, json=body, params=params, timeout=15
    )
    return r


def admin_rest(method, path, body=None, params=None):
    return rest(method, path, SERVICE_ROLE, body, params)


# ============================================================================
# Setup — cria 3 users via Admin API
# ============================================================================
print("=" * 70)
print("SETUP — Criando 3 users de teste")
print("=" * 70)

run_id = uuid.uuid4().hex[:8]
admin_email = f"test-admin-{run_id}@fabd.test"
diretor_email = f"test-diretor-{run_id}@fabd.test"
diretor2_email = f"test-diretor2-{run_id}@fabd.test"
membro_email = f"test-membro-{run_id}@fabd.test"
PWD = "TestPwd!2026"

try:
    admin_uid = admin_create_user(admin_email, PWD)
    print(f"  admin: {admin_email} ({admin_uid})")
    diretor_uid = admin_create_user(diretor_email, PWD)
    print(f"  diretor: {diretor_email} ({diretor_uid})")
    diretor2_uid = admin_create_user(diretor2_email, PWD)
    print(f"  diretor2: {diretor2_email} ({diretor2_uid})")
    membro_uid = admin_create_user(membro_email, PWD)
    print(f"  membro: {membro_email} ({membro_uid})")

    admin_tok = signin(admin_email, PWD)
    diretor_tok = signin(diretor_email, PWD)
    diretor2_tok = signin(diretor2_email, PWD)
    membro_tok = signin(membro_email, PWD)
    print("  Tokens obtidos OK")
except Exception as e:
    print(f"  ERRO setup: {e}")
    sys.exit(1)

# ============================================================================
# Cenarios
# ============================================================================
print()
print("=" * 70)
print("CENARIOS")
print("=" * 70)

# 1. Admin cria workspace (precisa created_by = auth.uid())
r = rest(
    "POST",
    "workspaces",
    admin_tok,
    body={"name": f"FABD Test {run_id}", "slug": f"fabd-test-{run_id}", "created_by": admin_uid},
)
log("01. Admin cria workspace", r.status_code == 201, f"status={r.status_code}, body={r.text[:200]}")
if r.status_code != 201:
    print("   ABORT: cenarios 2-22 dependem do workspace; saindo cedo")
    sys.exit(1)
ws_id = r.json()[0]["id"]

# 2. Inserir o admin como member (admin) via service_role (auto-bootstrap)
r = admin_rest(
    "POST",
    "workspace_members",
    body={
        "workspace_id": ws_id,
        "user_id": admin_uid,
        "role": "admin",
        "status": "active",
        "approved_by": admin_uid,
        "approved_at": "now()",
        "google_full_name": "Admin Test",
    },
)
log("02. Admin auto-cadastrado como member admin (service_role)", r.status_code == 201, f"status={r.status_code}")

# 3. Diretor cria request pending
r = rest("POST", "workspace_members", diretor_tok, body={
    "workspace_id": ws_id, "user_id": diretor_uid, "role": "membro", "status": "pending",
    "google_full_name": "Diretor Test",
})
log("03. Diretor cria request pending", r.status_code == 201, f"status={r.status_code} body={r.text[:150]}")

# 4. Membro cria request pending
r = rest("POST", "workspace_members", membro_tok, body={
    "workspace_id": ws_id, "user_id": membro_uid, "role": "membro", "status": "pending",
    "google_full_name": "Membro Test",
})
log("04. Membro cria request pending", r.status_code == 201, f"status={r.status_code}")

# 5. Diretor pending NAO ve outros members (so o seu)
r = rest("GET", "workspace_members", diretor_tok, params={"workspace_id": f"eq.{ws_id}"})
log(
    "05. Diretor pending so ve seu proprio member",
    r.status_code == 200 and len(r.json()) == 1 and r.json()[0]["user_id"] == diretor_uid,
    f"status={r.status_code} count={len(r.json()) if r.status_code==200 else '?'}",
)

# 6. Admin promove diretor pra role=diretor + status=active
r = admin_rest(
    "POST",
    "workspace_members",
    body={"workspace_id": ws_id, "user_id": diretor2_uid, "role": "diretor", "status": "active",
          "approved_by": admin_uid, "google_full_name": "Diretor2 Test"},
)
diretor2_member_id = r.json()[0]["id"] if r.status_code == 201 else None
log("06. Admin cadastra diretor2 como diretor active (via service_role)", r.status_code == 201, f"status={r.status_code}")

# Atualizar diretor pra active+diretor (admin atualiza via JWT)
r = rest("PATCH", "workspace_members", admin_tok,
         params={"workspace_id": f"eq.{ws_id}", "user_id": f"eq.{diretor_uid}"},
         body={"status": "active", "role": "diretor", "approved_by": admin_uid})
log("07. Admin (JWT) aprova diretor (status=active, role=diretor)", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

# Atualizar membro pra active+membro
r = rest("PATCH", "workspace_members", admin_tok,
         params={"workspace_id": f"eq.{ws_id}", "user_id": f"eq.{membro_uid}"},
         body={"status": "active", "role": "membro", "approved_by": admin_uid})
log("08. Admin (JWT) aprova membro (status=active, role=membro)", r.status_code == 200, f"status={r.status_code}")

# Refresh tokens (claims podem ter cache)
diretor_tok = signin(diretor_email, PWD)
diretor2_tok = signin(diretor2_email, PWD)
membro_tok = signin(membro_email, PWD)

# 9. Membro NAO pode aprovar outro
r = rest("POST", "workspace_members", membro_tok, body={
    "workspace_id": ws_id, "user_id": str(uuid.uuid4()), "role": "membro", "status": "active",
})
log("09. Membro NAO pode criar member active", r.status_code in (400, 401, 403, 409), f"status={r.status_code}")

# 10. Admin cria diretoria
r = rest("POST", "directories", admin_tok, body={
    "workspace_id": ws_id, "name": "Tecnica", "slug": "tecnica",
    "icon": "mdi:trophy-outline", "color": "#1E3A8A", "order_index": 1,
    "created_by": admin_uid,
})
log("10. Admin cria diretoria 'Tecnica'", r.status_code == 201, f"status={r.status_code} body={r.text[:200]}")
dir_id = r.json()[0]["id"] if r.status_code == 201 else None

# 11. Diretor NAO pode criar diretoria (so admin)
r = rest("POST", "directories", diretor_tok, body={
    "workspace_id": ws_id, "name": "Marketing", "slug": "marketing",
    "icon": "mdi:bullhorn-outline", "color": "#C41E2A", "order_index": 2,
    "created_by": diretor_uid,
})
log("11. Diretor NAO pode criar diretoria", r.status_code in (400, 401, 403), f"status={r.status_code}")

# 12. Diretor cria projeto na diretoria
r = rest("POST", "projects", diretor_tok, body={
    "directory_id": dir_id, "name": "1a Etapa Campeonato Alagoano",
    "responsible_user_id": diretor_uid, "created_by": diretor_uid,
})
log("12. Diretor cria projeto", r.status_code == 201, f"status={r.status_code} body={r.text[:200]}")
proj_id = r.json()[0]["id"] if r.status_code == 201 else None

# 13. Diretor cria fluxo no seu projeto
r = rest("POST", "flows", diretor_tok, body={
    "project_id": proj_id, "name": "Pre e pos torneio", "type": "continuous",
    "created_by": diretor_uid,
})
log("13. Diretor cria fluxo continuo", r.status_code == 201, f"status={r.status_code} body={r.text[:200]}")
flow_id = r.json()[0]["id"] if r.status_code == 201 else None

# 14. Diretor cria 3 fases no seu fluxo
fases_ids = []
for i, name in enumerate(["Pre-torneio", "Torneio", "Pos-torneio"]):
    r = rest("POST", "phases", diretor_tok, body={
        "flow_id": flow_id, "name": name, "order_index": i,
        "created_by": diretor_uid,
    })
    fases_ids.append(r.json()[0]["id"] if r.status_code == 201 else None)
log("14. Diretor cria 3 fases", all(fases_ids) and len(fases_ids) == 3, f"ids={fases_ids}")

# 15. Diretor2 NAO pode editar fluxo do diretor (so quem criou)
r = rest("PATCH", "flows", diretor2_tok, params={"id": f"eq.{flow_id}"}, body={"name": "Hackeado"})
# Sem rows afetadas (RLS bloqueia silenciosamente em update — licao Feedback Supabase Update Silent Zero Rows)
# verificar via select
ok = r.status_code == 200 and len(r.json()) == 0
log("15. Diretor2 NAO pode editar fluxo de outro diretor", ok, f"status={r.status_code} rows={len(r.json()) if r.status_code==200 else '?'}")

# 16. Diretor2 PODE comentar no fluxo do diretor
r = rest("POST", "flow_comments", diretor2_tok, body={
    "flow_id": flow_id, "author_id": diretor2_uid, "content": "Otimo trabalho! https://fabd.com.br",
})
log("16. Diretor2 pode comentar em fluxo de outro", r.status_code == 201, f"status={r.status_code}")

# 17. Membro PODE comentar
r = rest("POST", "flow_comments", membro_tok, body={
    "flow_id": flow_id, "author_id": membro_uid, "content": "Comentario do membro",
})
log("17. Membro pode comentar em fluxo", r.status_code == 201, f"status={r.status_code}")

# 18. Membro NAO pode criar fluxo
r = rest("POST", "flows", membro_tok, body={
    "project_id": proj_id, "name": "Fluxo do membro",
})
log("18. Membro NAO pode criar fluxo", r.status_code in (400, 401, 403), f"status={r.status_code}")

# 19. Diretor cria campos na fase 1 (text fixed e checkbox mobile)
r = rest("POST", "phase_fields", diretor_tok, body={
    "phase_id": fases_ids[0], "type": "text", "label": "Nome do ginasio",
    "mode": "fixed", "order_index": 0, "created_by": diretor_uid,
})
field_text = r.json()[0]["id"] if r.status_code == 201 else None
r = rest("POST", "phase_fields", diretor_tok, body={
    "phase_id": fases_ids[0], "type": "checkbox", "label": "Inscricoes abertas",
    "mode": "mobile", "order_index": 1, "created_by": diretor_uid,
})
field_check = r.json()[0]["id"] if r.status_code == 201 else None
log("19. Diretor cria 2 campos (text fixed + checkbox mobile)", bool(field_text and field_check),
    f"text={field_text}, check={field_check}")

# 20. Membro PODE preencher phase_field_value
r = rest("POST", "phase_field_values", membro_tok, body={
    "phase_field_id": field_text, "current_phase_id": fases_ids[0],
    "value_text": "Ginasio Roberto Marinho", "updated_by": membro_uid,
})
log("20. Membro pode preencher campo (phase_field_value)", r.status_code == 201, f"status={r.status_code} body={r.text[:200]}")

# Bonus: audit_log via funcao log_audit (chamada com JWT do admin pra auth.uid() funcionar)
r = rest("POST", "rpc/log_audit", admin_tok, body={
    "p_workspace_id": ws_id, "p_entity": "flow", "p_entity_id": flow_id,
    "p_action": "create", "p_changes": {"after": {"name": "Pre e pos torneio"}},
    "p_context": {"flow_id": flow_id, "project_id": proj_id},
})
# Membro pode ler audit_log do workspace
r = rest("GET", "audit_log", membro_tok, params={"workspace_id": f"eq.{ws_id}"})
audit_count = len(r.json()) if r.status_code == 200 else -1
log("21. Audit_log: membro le entradas do workspace", r.status_code == 200 and audit_count >= 1,
    f"status={r.status_code} count={audit_count}")

# 22. Membro NAO pode escrever audit_log direto
r = rest("POST", "audit_log", membro_tok, body={
    "workspace_id": ws_id, "user_id": membro_uid,
    "entity": "flow", "entity_id": flow_id, "action": "fake",
})
log("22. Membro NAO pode INSERT direto em audit_log", r.status_code in (400, 401, 403), f"status={r.status_code}")

# ============================================================================
# Cleanup
# ============================================================================
print()
print("=" * 70)
print("CLEANUP")
print("=" * 70)

try:
    # cascade vai deletar tudo
    admin_rest("DELETE", "workspaces", params={"id": f"eq.{ws_id}"})
    for uid in (admin_uid, diretor_uid, diretor2_uid, membro_uid):
        admin_delete_user(uid)
    print("  Cleanup OK")
except Exception as e:
    print(f"  Cleanup parcial: {e}")

# ============================================================================
# Resultado
# ============================================================================
print()
print("=" * 70)
total = results["pass"] + results["fail"]
print(f"RESULTADO: {results['pass']}/{total} PASS, {results['fail']} FAIL")
print("=" * 70)
if results["errors"]:
    print()
    print("ERROS:")
    for e in results["errors"]:
        print(f"  - {e}")

sys.exit(0 if results["fail"] == 0 else 1)
