import {spawnSync} from 'node:child_process';

/**
 * Runs a command synchronously and throws `failure(status)` when it exits non-zero.
 * On Windows, npm is `npm.cmd`, which Node only starts through a shell. Callers pass fixed
 * literal arguments, so joining them into one shell command is safe. Elsewhere, no shell is used.
 */
export function runCommand(command, args, options, failure) {
  const result =
    process.platform === 'win32'
      ? spawnSync([command, ...args].join(' '), {...options, stdio: 'inherit', shell: true})
      : spawnSync(command, args, {...options, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw failure(result.status);
}
