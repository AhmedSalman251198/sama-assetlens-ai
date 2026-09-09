# AssetLens AI R14.3 — Users & Roles

## What changed

- Creating a user is now one complete operation: pre-approve the profile, assign projects, then send the Supabase login invitation.
- Editing an existing user updates the name, role, and project assignments without creating a duplicate account.
- The email address is locked while editing so an accidental change cannot create a second profile.
- Account state is visible as active, waiting for invitation, or disabled.
- Roles are explained in the interface:
  - **Administrator:** all projects and structure/configuration management.
  - **Surveyor:** capture and access to explicitly assigned projects.
- Only `eng.ahmedsalman96@gmail.com` can create users, resend invitations, change roles, or disable accounts.
- The super administrator cannot disable their own account.

## Database requirement

No additional SQL is required if `supabase/migrations/007_super_admin_account_control.sql` was already run successfully.

## Deployment

Push this release to the `main` branch or upload the complete project, then redeploy in Vercel. Keep the existing Supabase environment variables unchanged.
