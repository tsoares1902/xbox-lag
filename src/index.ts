import { readFileSync } from 'node:fs';

import { CliAdapter } from './adapters/cli/CliAdapter.js';

/**
 * Represents the application package metadata.
 */
interface PackageMetadata {
  name: string;
  version: string;
}

/**
 * Reads and validates the application package metadata.
 *
 * @returns {PackageMetadata}
 */
function getPackageMetadata(): PackageMetadata {
  const metadata: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );

  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('name' in metadata) ||
    typeof metadata.name !== 'string' ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
  ) {
    throw new Error('package.json must contain string name and version fields.');
  }

  return {
    name: metadata.name,
    version: metadata.version,
  };
}

/**
 * Initializes and runs the command-line application.
 *
 * @returns {void}
 */
function main(): void {
  const { name, version } = getPackageMetadata();

  const cli = new CliAdapter(name, version);

  cli.run();
}

main();
