import { readFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';

/**
 * Exibe a identificação do projeto e do ambiente de execução.
 *
 * @returns {void}
 */
function main(): void {
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
    throw new Error('package.json deve conter name e version como strings.');
  }

  console.log(`${metadata.name} v${metadata.version}`);
  console.log(`Sistema operacional: ${platform()} ${release()}`);
  console.log(`Arquitetura: ${arch()}`);
  console.log(`Node.js: ${process.version}`);
}

main();
