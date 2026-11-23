// Shared rule for Validate (ci.yml) and publishing (pages-plan.mjs): which changes are documentation only.
// Narrow and explicit. Anything else, or anything unknown, is code.
const alwaysCode = ['.github/', 'scripts/', 'tests/', 'src/', 'public/'];

export function isDocumentation(path) {
  if (typeof path !== 'string' || path === '' || path.startsWith('/') || path.split('/').includes('..')) return false;
  if (alwaysCode.some(prefix => path.startsWith(prefix))) return false;
  return path.startsWith('docs/') || path.endsWith('.md');
}

/**
 * files: GitHub file entries ({filename, previous_filename?}). A rename counts both names.
 * complete: false when GitHub may have truncated the list; then the change counts as code.
 */
export function classifyChanges(files, complete = true) {
  const paths = Array.isArray(files)
    ? files.flatMap(file => [file?.filename, ...(file?.previous_filename ? [file.previous_filename] : [])])
    : [];
  const code = paths.filter(path => !isDocumentation(path));
  const docsOnly = complete && paths.length > 0 && code.length === 0;
  return {docsOnly, paths, code};
}

// Step name in ci.yml that runs only when Validate skipped the heavy steps. Publishing rejects such runs.
export const docsOnlyStep = 'Bare dokumentasjon: tunge steg hoppet over';
