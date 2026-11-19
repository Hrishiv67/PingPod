-- Removes every QA test account (qa-*@example.test) and everything they created, so the live
-- leaderboards are clean again. Safe to run repeatedly. Run in the Supabase SQL editor (or MCP).
-- Replace __QA_CODE_HASH__ with the hash used in qa_users_setup.sql (an unused code is removed too).
-- Note: account D deletes itself during the suite, leaving an orphaned "account.deleted_by_player"
-- audit row. It is removed below if it was written after the QA accounts were created; run setup,
-- tests and teardown back-to-back so a real player's deletion record can't fall in that window.
do $$
declare qa uuid[] := array(select id from auth.users where email like 'qa-%@example.test');
        first_qa timestamptz := (select min(created_at) from auth.users where email like 'qa-%@example.test');
begin
  delete from public.crews where name like 'QA %';
  delete from private.admin_claim_codes where used_by = any (qa) or code_hash = '__QA_CODE_HASH__';
  delete from private.rate_events where user_id = any (qa);
  delete from private.audit_log where actor_id = any (qa) or target_id = any (array(select unnest(qa)::text));
  -- D's self-deletion: an orphaned deletion row created while the QA accounts existed.
  delete from private.audit_log
   where action = 'account.deleted_by_player' and first_qa is not null and created_at >= first_qa
     and not exists (select 1 from auth.users u where u.id = actor_id)
     and target_id not in (select id::text from auth.users)
     and not exists (select 1 from public.support_requests r where r.user_id::text = target_id);
  delete from auth.users where id = any (qa);  -- cascades to profiles, sessions, memberships, ratings, requests
end $$;
select (select count(*) from auth.users where email like 'qa-%@example.test') as qa_users_left,
       (select count(*) from public.get_leaderboard('minutes', 'all', 'community', 200)) as public_board_rows;
