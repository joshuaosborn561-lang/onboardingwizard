# Protecting `main`

GitHub branch protection is repository configuration and cannot be enforced by a
committed file alone. A repository administrator should configure it once:

1. Open **Settings → Branches → Add branch protection rule**.
2. Set the branch name pattern to `main`.
3. Enable **Require a pull request before merging**.
4. Require **1 approval** (the other contributor).
5. Enable **Dismiss stale pull request approvals when new commits are pushed**.
6. Enable **Require conversation resolution before merging**.
7. Enable **Require status checks to pass before merging**.
8. Select the `CI / Validate` status check after it has run once.
9. Enable **Do not allow bypassing the above settings** if that matches the
   repository owner's emergency-access policy.
10. Disable force pushes and branch deletion.

Recommended merge setting: enable squash merging and use it for focused feature
branches.

These settings enforce the workflow in [`CONTRIBUTING.md`](../CONTRIBUTING.md);
the CI workflow itself does not prevent direct pushes unless branch protection is
enabled in GitHub.

