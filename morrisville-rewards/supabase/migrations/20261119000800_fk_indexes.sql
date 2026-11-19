-- PingPod Morrisville Rewards · 008 covering indexes for foreign keys (performance advisor).
create index if not exists crews_owner on public.crews (owner_id);
create index if not exists play_sessions_reviewed_by on public.play_sessions (reviewed_by);
create index if not exists play_sessions_venue on public.play_sessions (venue_id);
create index if not exists spindex_verified_by on public.spindex_ratings (verified_by);
create index if not exists support_requests_resolved_by on public.support_requests (resolved_by);
create index if not exists support_requests_session on public.support_requests (session_id);
create index if not exists support_requests_user on public.support_requests (user_id, created_at desc);
