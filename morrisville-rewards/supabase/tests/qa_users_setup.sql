-- Creates four QA accounts for tests/integration.test.mjs (email+password, already confirmed),
-- plus a one-time *staff* claim code. Replace the placeholders before running:
--   __QA_PASSWORD__   any strong password (export it as QA_PASSWORD for the test run)
--   __QA_CODE_HASH__  sha256 hex of the staff code with dashes removed, uppercase
--                     e.g. printf %s ABCD2345EFGH | sha256sum   (export ABCD-2345-EFGH as QA_STAFF_CODE)
-- Never commit real values. Run qa_users_teardown.sql afterwards.
do $$
declare e text; uid uuid;
begin
  foreach e in array array['qa-a@example.test', 'qa-b@example.test', 'qa-c@example.test', 'qa-d@example.test'] loop
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
      reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', e,
      extensions.crypt('__QA_PASSWORD__', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true), 'email', now(), now(), now());
  end loop;
end $$;
insert into private.admin_claim_codes (code_hash, role, expires_at)
values ('__QA_CODE_HASH__', 'staff', now() + interval '1 day');
