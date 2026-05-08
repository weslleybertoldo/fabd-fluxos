-- Defesa em camadas: por padrao Postgres concede EXECUTE em funcoes pra `public`,
-- entao `grant execute ... to authenticated` na migration anterior nao restringe.
-- Aqui revogamos de public e mantemos so pra authenticated.

revoke execute on function count_overdue_phases_per_project(uuid[]) from public;
revoke execute on function count_overdue_phases_per_project(uuid[]) from anon;
grant execute on function count_overdue_phases_per_project(uuid[]) to authenticated;
