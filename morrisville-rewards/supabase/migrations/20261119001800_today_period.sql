-- Boards get a "Today" view: p_period = 'day' (Morrisville calendar day) alongside week, month and all.
create or replace function private.period_start(p_period text) returns date language plpgsql stable set search_path = '' as $$
begin
  return case p_period
    when 'day' then private.today()
    when 'week' then private.week_start(private.today())
    when 'month' then date_trunc('month', private.today()::timestamp)::date
    when 'all' then date '2000-01-01'
    else null end;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
