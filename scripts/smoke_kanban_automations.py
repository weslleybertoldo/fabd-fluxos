"""Smoke E2E: automacao entre Kanbans (disparo, idempotencia, laco, RLS).

Roda tudo numa transacao psycopg2 e da ROLLBACK no fim — nao deixa nada no banco.

Uso:
  FABD_FLUXOS_DB_PASSWORD=... python3 scripts/smoke_kanban_automations.py
  FABD_FLUXOS_DB_PASSWORD=... python3 scripts/smoke_kanban_automations.py --migration  # aplica a migration W2 antes
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
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({"sub": uid, "role": "authenticated"}),))
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (uid,))


def as_postgres():
    cur.execute("reset role")


def attempt(sql, params=None):
    cur.execute("savepoint sp")
    try:
        cur.execute(sql, params)
        rc = cur.rowcount
        cur.execute("release savepoint sp")
        return True, rc
    except Exception as e:  # noqa: BLE001
        cur.execute("rollback to savepoint sp")
        return False, str(e).splitlines()[0]


def one(sql, params=None):
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else None


def count(sql, params=None):
    return one(sql, params) or 0


try:
    if "--migration" in sys.argv:
        cur.execute((MIGRATIONS / "20260927010000_kanban_automations.sql").read_text())
        print("migration W2 aplicada dentro da transacao")

    # ---------------------------------------------------------------- fixture
    ids = {k: str(uuid.uuid4()) for k in ["A", "D1", "D2", "M", "O"]}
    for k, uid in ids.items():
        cur.execute("insert into auth.users (id, email) values (%s, %s)",
                    (uid, f"smoke-auto-{k.lower()}-{uid[:8]}@example.test"))
    ws = one("insert into workspaces (name, slug, created_by, is_discoverable) values "
             "('Smoke Auto', %s, %s, false) returning id", (f"smoke-auto-{ids['A'][:8]}", ids["A"]))
    ws2 = one("insert into workspaces (name, slug, created_by, is_discoverable) values "
              "('Smoke Auto 2', %s, %s, false) returning id", (f"smoke-auto2-{ids['O'][:8]}", ids["O"]))
    for k, role in [("A", "admin"), ("D1", "diretor"), ("D2", "diretor"), ("M", "membro")]:
        cur.execute("insert into workspace_members (workspace_id, user_id, role, status) values (%s,%s,%s,'active')",
                    (ws, ids[k], role))
    cur.execute("insert into workspace_members (workspace_id, user_id, role, status) values (%s,%s,'admin','active')",
                (ws2, ids["O"]))
    d_geral = one("insert into directories (workspace_id, name, slug, created_by) values (%s,'Geral','geral',%s) returning id",
                  (ws, ids["A"]))
    d_mkt = one("insert into directories (workspace_id, name, slug, created_by) values (%s,'Marketing','marketing',%s) returning id",
                (ws, ids["A"]))
    p_geral = one("insert into projects (directory_id, name, created_by) values (%s,'Torneio',%s) returning id",
                  (d_geral, ids["A"]))
    p_mkt = one("insert into projects (directory_id, name, created_by) values (%s,'Divulgacao',%s) returning id",
                (d_mkt, ids["A"]))
    d_out = one("insert into directories (workspace_id, name, slug, created_by) values (%s,'Fora','fora',%s) returning id",
                (ws2, ids["O"]))
    p_out = one("insert into projects (directory_id, name, created_by) values (%s,'Fora',%s) returning id",
                (d_out, ids["O"]))

    def kanban(project, name, creator, phases):
        k = one("insert into kanbans (project_id, name, created_by) values (%s,%s,%s) returning id",
                (project, name, creator))
        ph = []
        for i, n in enumerate(phases):
            ph.append(one("insert into kanban_phases (kanban_id, name, position) values (%s,%s,%s) returning id",
                          (k, n, i)))
        return k, ph

    as_postgres()
    kA, (a1, a2, a3) = kanban(p_geral, "A", ids["D1"], ["A1", "A2", "A3"])
    kB, (b1, b2) = kanban(p_mkt, "B", ids["D2"], ["B1", "B2"])
    kC, (c1,) = kanban(p_mkt, "C", ids["D2"], ["C1"])
    kD, (dd1,) = kanban(p_mkt, "D", ids["D2"], ["D1"])
    kE, (e1,) = kanban(p_mkt, "E", ids["D2"], ["E1"])
    kX, (x1,) = kanban(p_out, "X", ids["O"], ["X1"])

    # ------------------------------------------------------------ criar regra
    as_user(ids["M"])
    ok, _ = attempt("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                    "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (kA, a2, kB, b1, ids["M"]))
    check("1. membro NAO cria automacao", not ok)
    as_user(ids["D2"])
    ok, _ = attempt("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                    "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (kA, a2, kB, b1, ids["D2"]))
    check("2. diretor que NAO edita a origem NAO cria automacao", not ok)
    as_user(ids["D1"])
    ok, err = attempt("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                      "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (kA, a2, kB, b1, ids["D1"]))
    check("3. dono do Kanban de origem cria automacao pra outra diretoria", ok, "" if ok else err)
    ok, _ = attempt("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                    "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (kA, a2, kX, x1, ids["D1"]))
    check("4. destino de OUTRO workspace e recusado", not ok)
    ok, _ = attempt("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                    "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (kA, a2, kA, a3, ids["D1"]))
    check("5. destino = o proprio Kanban e recusado", not ok)
    ok, _ = attempt("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                    "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (kA, b2, kB, b1, ids["D1"]))
    check("6. fase de origem de outro Kanban e recusada", not ok)

    # ---------------------------------------------------------------- disparo
    ok, _ = attempt("insert into kanban_cards (kanban_id, phase_id, title, description, tags, created_by) "
                    "values (%s,%s,'Arte do torneio','Banner 1x2m','{urgente}',%s)", (kA, a1, ids["D1"]))
    card = one("select id from kanban_cards where kanban_id=%s and title='Arte do torneio'", (kA,))
    check("7. criar card fora da fase X NAO dispara", count("select count(*) from kanban_cards where kanban_id=%s", (kB,)) == 0)
    ok, rc = attempt("update kanban_cards set phase_id=%s where id=%s", (a2, card))
    check("8. mover pra fase X dispara (card criado no Kanban B)",
          ok and count("select count(*) from kanban_cards where kanban_id=%s", (kB,)) == 1)
    as_postgres()
    row = None
    cur.execute("select phase_id, title, description, tags, source_card_id, created_by_automation_id, created_by "
                "from kanban_cards where kanban_id=%s", (kB,))
    row = cur.fetchone()
    check("9. card novo na fase Z com titulo, descricao e tags copiados + vinculo",
          row is not None and row[0] == b1 and row[1] == "Arte do torneio" and row[2] == "Banner 1x2m"
          and row[3] == ["urgente"] and row[4] == card and row[5] is not None and row[6] == ids["D1"])
    check("10. auditoria do card criado pela automacao",
          count("select count(*) from audit_log where entity='kanban_card' and action='create' "
                "and (changes->'after'->>'automacao')::boolean and user_id=%s", (ids["D1"],)) == 1)

    as_user(ids["D1"])
    attempt("update kanban_cards set phase_id=%s where id=%s", (a3, card))
    attempt("update kanban_cards set phase_id=%s where id=%s", (a2, card))
    check("11. sair e voltar pra X NAO duplica", count("select count(*) from kanban_cards where kanban_id=%s", (kB,)) == 1)

    ok, _ = attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by) values (%s,%s,'Direto na X',%s)",
                    (kA, a2, ids["D1"]))
    check("12. card criado direto na fase X dispara",
          ok and count("select count(*) from kanban_cards where kanban_id=%s and title='Direto na X'", (kB,)) == 1)

    # membro de outra diretoria sem acesso ao destino: responsavel move e dispara
    cur_card = one("select id from kanban_cards where kanban_id=%s and title='Direto na X'", (kA,))
    attempt("insert into kanban_card_responsibles (card_id, user_id, assigned_by) values (%s,%s,%s)",
            (card, ids["M"], ids["D1"]))
    ok, _ = attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by) values (%s,%s,'Do membro',%s)",
                    (kA, a1, ids["D1"]))
    m_card = one("select id from kanban_cards where kanban_id=%s and title='Do membro'", (kA,))
    attempt("insert into kanban_card_responsibles (card_id, user_id, assigned_by) values (%s,%s,%s)",
            (m_card, ids["M"], ids["D1"]))
    as_user(ids["M"])
    ok, rc = attempt("update kanban_cards set phase_id=%s where id=%s", (a2, m_card))
    check("13. membro responsavel move e a automacao cria no destino (sem acesso de escrita la)",
          ok and rc == 1 and count("select count(*) from kanban_cards where kanban_id=%s and title='Do membro'", (kB,)) == 1)

    # forjar vinculo
    as_user(ids["D2"])
    ok, _ = attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by, source_card_id) "
                    "values (%s,%s,'Forjado',%s,%s)", (kB, b2, ids["D2"], card))
    check("14. NAO da pra criar card forjando vinculo de automacao", not ok)

    # pausada nao dispara
    as_user(ids["D1"])
    auto = one("select id from kanban_automations where source_phase_id=%s and target_phase_id=%s", (a2, b1))
    attempt("update kanban_automations set active=false where id=%s", (auto,))
    attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by) values (%s,%s,'Pausada',%s)",
            (kA, a2, ids["D1"]))
    check("15. automacao pausada NAO dispara",
          count("select count(*) from kanban_cards where kanban_id=%s and title='Pausada'", (kB,)) == 0)
    attempt("update kanban_automations set target_kanban_id=%s where id=%s", (kC, auto))
    check("16. destino da regra nao muda na edicao (so ativa/pausa)",
          one("select target_kanban_id from kanban_automations where id=%s", (auto,)) == kB)
    attempt("update kanban_automations set active=true where id=%s", (auto,))

    # encadeamento A -> B -> C -> D -> E: para em 3 saltos
    as_postgres()
    for src_k, src_p, dst_k, dst_p, owner in [(kB, b1, kC, c1, ids["D2"]), (kC, c1, kD, dd1, ids["D2"]),
                                              (kD, dd1, kE, e1, ids["D2"])]:
        cur.execute("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                    "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (src_k, src_p, dst_k, dst_p, owner))
    as_user(ids["D1"])
    attempt("insert into kanban_cards (kanban_id, phase_id, title, created_by) values (%s,%s,'Cadeia',%s)",
            (kA, a1, ids["D1"]))
    ch = one("select id from kanban_cards where kanban_id=%s and title='Cadeia'", (kA,))
    attempt("update kanban_cards set phase_id=%s where id=%s", (a2, ch))
    as_postgres()
    n = {name: count("select count(*) from kanban_cards where kanban_id=%s and title='Cadeia'", (k,))
         for name, k in [("B", kB), ("C", kC), ("D", kD), ("E", kE)]}
    check("17. encadeamento vai ate 3 saltos e para", n == {"B": 1, "C": 1, "D": 1, "E": 0}, str(n))

    # laco A -> B -> A e contido
    cur.execute("insert into kanban_automations (source_kanban_id, source_phase_id, target_kanban_id, "
                "target_phase_id, created_by) values (%s,%s,%s,%s,%s)", (kB, b2, kA, a2, ids["D2"]))
    as_user(ids["D2"])
    b_card = one("select id from kanban_cards where kanban_id=%s and title='Arte do torneio'", (kB,))
    ok, err = attempt("update kanban_cards set phase_id=%s where id=%s", (b2, b_card))
    as_postgres()
    total = count("select count(*) from kanban_cards where title='Arte do torneio'")
    check("18. laco A -> B -> A termina sem erro", ok and total <= 6, f"cards={total}" + ("" if ok else f" err={err}"))

    # excluir a fase de destino remove a regra
    as_user(ids["A"])
    attempt("delete from kanban_cards where kanban_id=%s", (kE,))
    ok, _ = attempt("delete from kanban_phases where id=%s", (e1,))
    as_postgres()
    check("19. excluir a fase destino remove a regra",
          ok and count("select count(*) from kanban_automations where target_phase_id=%s", (e1,)) == 0)

    # excluir card de origem: card criado fica, sem vinculo
    as_user(ids["A"])
    ok, _ = attempt("delete from kanban_cards where id=%s", (card,))
    as_postgres()
    check("20. excluir o card de origem mantem o criado, sem vinculo",
          ok and count("select count(*) from kanban_cards where kanban_id=%s and title='Arte do torneio' "
                       "and source_card_id is null and created_by_automation_id is not null", (kB,)) >= 1)

    as_user(ids["O"])
    check("21. de fora NAO le automacoes", count("select count(*) from kanban_automations where source_kanban_id=%s", (kA,)) == 0)
    as_user(ids["M"])
    check("22. membro le as automacoes e os disparos",
          count("select count(*) from kanban_automations where source_kanban_id=%s", (kA,)) >= 1
          and count("select count(*) from kanban_automation_runs") >= 1)
    ok, _ = attempt("insert into kanban_automation_runs (automation_id, source_card_id) values (%s,%s)", (auto, m_card))
    check("23. ninguem grava disparo na mao", not ok)
finally:
    conn.rollback()
    conn.close()

print(f"\n{results['pass']}/{results['pass'] + results['fail']} PASS")
if results["fail"]:
    print("falharam:", ", ".join(results["failed"]))
    sys.exit(1)
