import { arch, platform, release } from 'node:os';
import { expect, test, vi } from 'vitest';

/**
 * Verifica a identificação exibida pela entrada da CLI.
 *
 * @returns {Promise<void>}
 */
async function verifyCliOutput(): Promise<void> {
  const output = vi.spyOn(console, 'log').mockImplementation(vi.fn());

  try {
    await import('../../src/index.js');

    expect(output.mock.calls).toEqual([
      ['game-route-optimizer v0.1.0'],
      [`Sistema operacional: ${platform()} ${release()}`],
      [`Arquitetura: ${arch()}`],
      [`Node.js: ${process.version}`],
    ]);
  } finally {
    output.mockRestore();
  }
}

test('exibe a identificação do projeto e do ambiente', verifyCliOutput);
