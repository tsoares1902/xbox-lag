import { arch, platform, release } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

describe('CLI integration', () => {
  describe('application entry point', () => {
    it('should display application and runtime information', async () => {
      const output = vi.spyOn(console, 'log').mockImplementation(vi.fn());

      try {
        await import('../../src/index.js');

        expect(output.mock.calls).toEqual([
          ['game-route-optimizer v0.1.0'],
          [`Operating system: ${platform()} ${release()}`],
          [`Architecture: ${arch()}`],
          [`Node.js: ${process.version}`],
        ]);
      } finally {
        output.mockRestore();
      }
    });
  });
});
