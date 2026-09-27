"""Smoke E2E: Kanban (tabelas, RLS e integridade).

Roda tudo numa transacao psycopg2 e da ROLLBACK no fim — nao deixa nada no banco.
Usuarios, workspace e dados sao criados dentro da transacao.

Uso:
  FABD_FLUXOS_DB_PASSWORD=... python3 scripts/smoke_kanban.py            # migration ja aplicada
  FABD_FLUXOS_DB_PASSWORD=... python3 scripts/smoke_kanban.py --migration  # aplica a migration dentro da transacao antes
"""
import json
import os
import sys
import uuid
from pathlib import Path

import psycopg2

REF = "nexvflddmubtcizervda"
HOST = os.environ.get("FABD_FLUXOS_DB_HOST", "aws-1-us-west-2.pooler.supabase.com")
USER = os.environ.get("FABD_FLUXOS_DB_USER", f"postgres.{REF}")
PASSWORD = os.environ.get("FABD_FLUXOS_DB_PASSWORD")
assert PASSWORD, "set FABD_FLUXOS_DB_PASSWORD"

MIGRATIONS = Path(__file__).resolve().parent.parent / "supabase" / "migrations"

results = {"pass": 0, "fail": 0, "failed": []}


def check(label, ok, detail=""):
    print(f"{'[PASS]' if ok else '[FAIL]'} {label}{(' — ' + detail) if detail else ''}")
    if ok:
        results["pass"] += 1
    else:
        results["fail"] += 1
        results["failed"].append(label)


conn = psycopg2.connect(host=HOST, port=5432, user=USER, password=PASSWORD, dbname="postgres",
                        connect_timeout=15)
conn.autocommit = False
cur = conn.cursor()


def as_user(uid):
    cur.execute("reset role")
    cur.execute("set local role authenticated")
    claims = json.dumps({"sub": uid, "role": "authenticated"})
    cur.execute("select set_config('request.jwt.claims', %s, true)", (claims,))
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid,))


def as_postgres():
    cur.execute("reset role")


def attempt(sql, params=None):
    """Roda num savepoint. Retorna (ok, rowcount|erro)."""
    cur.execute("savepoint sp")
    try:
        cur.execute(sql, params)
        rc = cur.rowcount
        cur.execute("release savepoint sp")
        return True, rc
    except Exception as e:  # noqa: BLE001 — queremos a mensagem do Postgres
        cur.execute("rollback to savepoint sp")
        return False, str(e).splitlines()[0]


def one(sql, params=None):
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else None


try:
    if "--migration" in sys.argv:
        cur.execute((MIGRATIONS / "20260927000000_kanbans.sql").read_text())
        print("migration aplicada dentro da transacao")

    # ---------------------------------------------------------------- fixture
    ids = {k: str(uuid.uuid4()) for k in ["A", "D1", "D2", "D3", "M", "M2", "O"]}
    for k, uid in ids.items():
        cur.execute("insert into auth.users (id, email) values (%s, %s)",
                    (uid, f"smoke-kanban-{k.lower()}-{uid[:8]}@example.test"))
    ws = one("insert into workspaces (name, slug, created_by, is_discoverable) values "
             "('Smoke Kanban', %s, %s, false) returning id", (f"smoke-kanban-{ids['A'][:8]}", ids["A"]))
    ws2 = one("insert into workspaces (name, slug, created_by, is_discoverable) values "
              "('Smoke Kanban 2', %s, %s, false) returning id", (f"smoke-kanban2-{ids['O'][:8]}", ids["O"]))
    for k, role in [("A", "admin"), ("D1", "diretor"), ("D2", "diretor"), ("D3", "diretor"),
                    ("M", "membro"), ("M2", "membro")]:
        cur.execute("insert into workspace_members (workspace_id, user_id, role, status) values (%s,%s,%s,'active')",
                    (ws, ids[k], role))
    cur.execute("insert into workspace_members (workspace_id, user_id, role, status) values (%s,%s,'admin','active')",
                (ws2, ids["O"]))
    d = one("insert into directories (workspace_id, name, slug, created_by) values (%s,'Geral','geral',%s) returning id",
            (ws, ids["A"]))
    p = one("insert into projects (directory_id, name, responsible_user_id, created_by) values (%s,'P',%s,%s) returning id",
            (d, ids["D3"], ids["A"]))
    d2 = one("insert into directories (workspace_id, name, slug, created_by) values (%s,'Outro','outro',%s) returning id",
             (ws2, ids["O"]))
    p2 = one("insert into projects (directory_id, name, created_by) values (%s,'P2',%s) returning id", (d2, ids["O"]))

    # ------------------------------------------------------------- criacao
    as_user(ids["D1"])
    ok, _ = attempt("insert into kanbans (project_id, name, created_by) values (%s,'K',%s)", (p, ids["D1"]))
    check("1. diretor cria Kanban", ok)
    k = one("select id from kanbans where project_id = %s and name = 'K'", (p,))
    ok, _ = attempt("insert into kanban_phases (kanban_id, name, position) values (%s,'F1',0),(%s,'F2',1),(%s,'F3',2)",
                    (k, k, k))
    check("2. dono cria fases", ok)
    f1, f2, f3 = [one("select id from kanban_phases where kanban_id=%s and name=%s", (k, n)) for n in ("F1", "F2", "F3")]
    ok, _ = attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by) values (%s,%s,'C',%s)",
                    (k, f1, ids["D1"]))
    check("3. dono cria card", ok)
    c = one("select id from kanban_cards where kanban_id=%s and title='C'", (k,))

    as_user(ids["M"])
    ok, _ = attempt("insert into kanbans (project_id, name, created_by) values (%s,'KM',%s)", (p, ids["M"]))
    check("4. membro NAO cria Kanban", not ok)
    ok, _ = attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by) values (%s,%s,'CM',%s)",
                    (k, f1, ids["M"]))
    check("5. membro NAO cria card", not ok)
    ok, rc = attempt("update kanban_cards set title='hack' where id=%s", (c,))
    check("6. membro NAO edita card", ok and rc == 0, f"rowcount={rc}")
    check("6b. membro le o card", one("select count(*) from kanban_cards where id=%s", (c,)) == 1)

    as_user(ids["D2"])
    ok, rc = attempt("update kanban_cards set title='hack' where id=%s", (c,))
    check("7. outro diretor NAO edita card", ok and rc == 0, f"rowcount={rc}")
    ok, _ = attempt("insert into kanban_phases (kanban_id, name, position) values (%s,'X',9)", (k,))
    check("7b. outro diretor NAO cria fase", not ok)
    ok, _ = attempt("insert into kanban_card_comments (card_id, author_id, content) values (%s,%s,'oi')",
                    (c, ids["D2"]))
    check("7c. diretor comenta", ok)

    as_user(ids["D3"])
    ok, rc = attempt("update kanban_cards set description='resp projeto' where id=%s", (c,))
    check("8. diretor responsavel do projeto edita card", ok and rc == 1, f"rowcount={rc}")

    as_user(ids["D1"])
    ok, _ = attempt("insert into kanban_card_responsibles (card_id, user_id, assigned_by) values (%s,%s,%s)",
                    (c, ids["M"], ids["D1"]))
    check("9. dono atribui membro como responsavel", ok)
    ok, _ = attempt("insert into kanban_card_responsibles (card_id, user_id, assigned_by) values (%s,%s,%s)",
                    (c, ids["O"], ids["D1"]))
    check("9b. NAO atribui quem e de fora do workspace", not ok)

    as_user(ids["M"])
    ok, rc = attempt("update kanban_cards set phase_id=%s, position=5 where id=%s", (f2, c))
    check("10. membro responsavel move o card", ok and rc == 1, f"rowcount={rc}")
    ok, _ = attempt("insert into kanban_card_comments (card_id, author_id, content) values (%s,%s,'feito')",
                    (c, ids["M"]))
    check("10b. membro responsavel comenta", ok)
    ok, rc = attempt("delete from kanban_cards where id=%s", (c,))
    check("11. membro responsavel NAO exclui card", ok and rc == 0, f"rowcount={rc}")
    ok, _ = attempt("insert into kanban_card_responsibles (card_id, user_id, assigned_by) values (%s,%s,%s)",
                    (c, ids["M2"], ids["M"]))
    check("12. membro NAO atribui responsavel", not ok)

    as_user(ids["M2"])
    ok, _ = attempt("insert into kanban_card_comments (card_id, author_id, content) values (%s,%s,'x')",
                    (c, ids["M2"]))
    check("12b. membro sem responsabilidade NAO comenta", not ok)

    # ------------------------------------------------------------ integridade
    as_user(ids["D1"])
    attempt("insert into kanbans (project_id, name, created_by) values (%s,'K2',%s)", (p, ids["D1"]))
    kb2 = one("select id from kanbans where project_id=%s and name='K2'", (p,))
    attempt("insert into kanban_phases (kanban_id, name, position) values (%s,'G1',0)", (kb2,))
    g1 = one("select id from kanban_phases where kanban_id=%s", (kb2,))
    ok, err = attempt("update kanban_cards set phase_id=%s where id=%s", (g1, c))
    check("13. card NAO vai pra fase de outro Kanban", not ok, err if ok else "")
    attempt("update kanban_cards set kanban_id=%s where id=%s", (kb2, c))
    check("14. kanban_id do card e imutavel", one("select kanban_id from kanban_cards where id=%s", (c,)) == k)
    ok, _ = attempt("delete from kanban_phases where id=%s", (f2,))
    check("15. fase com card NAO e apagada", not ok)
    ok, rc = attempt("delete from kanban_phases where id=%s", (f3,))
    check("16. fase vazia e apagada", ok and rc == 1, f"rowcount={rc}")
    ok, rc = attempt("delete from kanbans where id=%s", (k,))
    check("17. diretor NAO exclui Kanban", ok and rc == 0, f"rowcount={rc}")
    ok, rc = attempt("update kanbans set name='K renomeado' where id=%s", (k,))
    check("17b. dono renomeia Kanban", ok and rc == 1, f"rowcount={rc}")
    attempt("update kanbans set project_id=%s where id=%s", (p2, k))
    as_postgres()
    check("17c. project_id do Kanban e imutavel", one("select project_id from kanbans where id=%s", (k,)) == p)

    as_user(ids["O"])
    check("18. de fora NAO le Kanban", one("select count(*) from kanbans where id=%s", (k,)) == 0)
    check("18b. de fora NAO le card", one("select count(*) from kanban_cards where kanban_id=%s", (k,)) == 0)
    ok, _ = attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by) values (%s,%s,'x',%s)",
                    (k, f1, ids["O"]))
    check("19. de fora NAO cria card", not ok)

    as_user(ids["A"])
    ok, rc = attempt("delete from kanbans where id=%s", (k,))
    check("20. admin exclui Kanban com cards", ok and rc == 1, f"rowcount={rc}")
    as_postgres()
    check("20b. cards e fases foram junto (cascade)",
          one("select count(*) from kanban_cards where kanban_id=%s", (k,)) == 0
          and one("select count(*) from kanban_phases where kanban_id=%s", (k,)) == 0)
finally:
    conn.rollback()
    conn.close()

print(f"\n{results['pass']}/{results['pass'] + results['fail']} PASS")
if results["fail"]:
    print("falharam:", ", ".join(results["failed"]))
    sys.exit(1)
