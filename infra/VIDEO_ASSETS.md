# Public video delivery

Video exports and local motion projects stay outside Git history. The token page
uses `/videos/oren-token-explainer-50-percent.mp4` and `/videos/oren-token-poster.jpg`.
For local development, keep both files under `app/public/videos/` (ignored).

Production mounts `/opt/oren/media/videos` read-only into the app container.
The directory persists across image releases. Docker excludes local videos from
its build context. The deployment workflow checks every SHA-256 in
`infra/videos.sha256` before activating a release, so missing or mismatched media
stops deployment rather than publishing a broken player.

Before the first push containing the token page, upload the reviewed assets using
the deployment account and its already verified SSH host key:

```powershell
./infra/upload-videos.ps1 -Destination user@host -Port 22 -DryRun
./infra/upload-videos.ps1 -Destination user@host -Port 22
```

Replace `user@host` and the port with the production deployment destination.
Dry run verifies local hashes without connecting. Upload verifies each remote
temporary file before replacing its destination. It does not restart containers.
Pass `-IdentityFile` with your SSH key path when using a dedicated deployment key.
Keep a separate backup of the ignored source projects and exports.

When revising a video, give the reviewed export a new filename, update the page
and manifest hashes, and upload the matching files before deployment. A new URL
prevents browsers from reusing cached video bytes. Keep older exports on the VPS
for releases that still reference them; media files are not part of container images.

The Titan changelog entry uses `/videos/oren-powered-by-titan-lift.mp4` and
`/videos/oren-powered-by-titan-lift-poster.jpg`. Keep the approved 10-second
1080p60 export and its poster in the same local/production video directories.
Both are included in `videos.sha256`; upload and verify them before deploying
the changelog reference. Earlier token-page assets remain required.

The draft Drip changelog entry uses `/videos/oren-drip-continuous-v4.mp4` and
`/videos/oren-drip-poster-v4.jpg`. These are the reviewed 17-second 1080p60 film
and its poster. Keep them under `app/public/videos/` locally; the source export
is `oren-drip-motion/renders/oren-drip-continuous-v4.mp4` in the main checkout.
The manifest includes both assets. Upload and verify them before publishing
the entry; adding this draft does not upload media or activate a release.
