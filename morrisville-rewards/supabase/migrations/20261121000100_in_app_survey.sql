-- In-app research survey (replaces the Google Form link).
-- Answers are anonymous: a response row has no user id. The profile only records that the player
-- finished, so the Home card can say thanks. Staff download all responses as CSV.

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  answers jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.survey_responses enable row level security;
revoke all on public.survey_responses from anon, authenticated;

alter table public.profiles add column if not exists survey_done_at timestamptz;

create or replace function public.submit_survey(p_answers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_profile(); k text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'Something went wrong with your answers.'; end if;
  if length(p_answers::text) > 20000 then raise exception 'Your answers are too long.'; end if;
  for k in select jsonb_object_keys(p_answers) loop
    if k !~ '^q([1-9]|1[0-9])(_other)?$' then raise exception 'Something went wrong with your answers.'; end if;
  end loop;
  if not (p_answers ? 'q1') then raise exception 'Please answer the first question.'; end if;
  if exists (select 1 from public.profiles where id = v_uid and survey_done_at is not null) then
    raise exception 'You already took the survey. Thank you!';
  end if;
  perform private.rate_limit('survey', 3, interval '1 hour');
  insert into public.survey_responses (answers) values (p_answers);
  update public.profiles set survey_done_at = now(), updated_at = now() where id = v_uid;
end $$;
revoke execute on function public.submit_survey(jsonb) from public, anon;
grant execute on function public.submit_survey(jsonb) to authenticated;

create or replace function public.admin_survey_export() returns setof public.survey_responses
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return query select * from public.survey_responses order by created_at;
end $$;
revoke execute on function public.admin_survey_export() from public, anon;
grant execute on function public.admin_survey_export() to authenticated;
