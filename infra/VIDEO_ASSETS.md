# Public video delivery

Video exports and local motion projects stay outside Git history. The token page
uses `/videos/oren-token-explainer.mp4` and `/videos/oren-token-poster.jpg`.
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

When replacing a video, review the export, update the manifest hashes, and upload
the matching files before deployment. For a rollback that expects older media,
restore the corresponding assets as well; media files are not versioned with the
container images.
