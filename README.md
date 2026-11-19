# PingPod Morrisville Rewards — beta branch

**Start here:** [`morrisville-rewards/`](morrisville-rewards/README.md). Resume notes are in [`morrisville-rewards/IMPLEMENTATION_STATUS.md`](morrisville-rewards/IMPLEMENTATION_STATUS.md).

This branch holds the Morrisville Rewards pilot app (React + Vite on Vercel, Supabase backend) alongside the older PingPod prototype files. Nothing in `main` was overwritten.

- Live app: https://pingpod-morrisville-rewards.vercel.app (iPad board at `/display`, QR sign at `/poster`, staff at `/admin`)
- Database: Supabase project `pingpod-morrisville`; schema and rules in `morrisville-rewards/supabase/migrations/`
- Staff guide for Joe: `morrisville-rewards/docs/STAFF_GUIDE.md`
- iOS app on the same backend: `morrisville-rewards/docs/SWIFT_INTEGRATION.md`

**For Claude Code:** "Continue from `morrisville-rewards/` using its existing app, migrations and IMPLEMENTATION_STATUS.md. Don't start from scratch."
