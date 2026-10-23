import { readFileSync } from 'node:fs';

import { CliAdapter } from './adapters/cli/CliAdapter.js';
import { MeasureLatencyUseCase } from './application/use-cases/MeasureLatencyUseCase.js';
import { WindowsIcmpAdapter } from './infrastructure/network/WindowsIcmpAdapter.js';

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
 * @returns {PackageMetadata} Application package metadata.
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
 * @returns {Promise<void>} Completion of the application.
 */
async function main(): Promise<void> {
  const { name, version } = getPackageMetadata();

  const networkProbe = new WindowsIcmpAdapter();
  const measureLatencyUseCase = new MeasureLatencyUseCase(networkProbe);
  const cli = new CliAdapter(name, version, measureLatencyUseCase);

  await cli.run(process.argv.slice(2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
