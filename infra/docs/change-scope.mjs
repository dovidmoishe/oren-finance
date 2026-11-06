// Shared routing files count only in a docs change; an isolated Caddy edit still
// follows the normal preview path. Renamed files must include their old scope.
export function isDocsOnlyChange(files) {
  const docs = (name) => name.startsWith('docs-site/') || name.startsWith('infra/docs/') ||
    name === '.github/workflows/docs-site.yml' || name === '.github/workflows/deploy-docs.yml';
  const integration = new Set(['Caddyfile', '.gitignore', '.github/workflows/docs-site.yml',
    '.github/workflows/deploy-docs.yml', '.github/workflows/deploy-production.yml', '.github/workflows/preview.yml']);
  return files.length > 0 && files.some((file) => docs(file.filename)) &&
    files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean))
      .every((name) => docs(name) || integration.has(name));
}
