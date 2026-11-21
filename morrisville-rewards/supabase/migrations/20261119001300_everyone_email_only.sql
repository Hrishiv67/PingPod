-- Players never use a password, not even accounts created before email-only sign-in existed:
-- switch every existing player account to the email-derived key (same formula as
-- src/lib/emailKey.ts and private.on_email_key). Staff and owner accounts keep their own password,
-- because the staff dashboard shows every player's email and can delete accounts.
-- Safe to re-run: accounts already on the key are skipped.
update auth.users u
   set encrypted_password = extensions.crypt(
         'Pp!' || left(encode(extensions.digest(lower(trim(u.email)) || '|pingpod-morrisville-email-only-v1', 'sha256'), 'hex'), 40) || '9',
         extensions.gen_salt('bf', 10)),
       updated_at = now()
 where u.email is not null and u.email <> ''
   and not exists (select 1 from private.admins a where a.user_id = u.id)
   and not private.on_email_key(u.id);
