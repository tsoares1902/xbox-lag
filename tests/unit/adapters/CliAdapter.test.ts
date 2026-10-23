import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliAdapter } from '../../../src/adapters/cli/CliAdapter.js';
import type { NetworkProbeInterface } from '../../../src/application/interfaces/NetworkProbeInterface.js';
import { MeasureLatencyUseCase } from '../../../src/application/use-cases/MeasureLatencyUseCase.js';
import { NetworkMetrics } from '../../../src/domain/entities/NetworkMetrics.js';
import { NetworkMeasurement } from '../../../src/domain/value-objects/NetworkMeasurement.js';

describe('CliAdapter', () => {
  let output: ReturnType<typeof vi.spyOn>;
  let execute: ReturnType<typeof vi.fn<(host: string, count: number) => Promise<NetworkMetrics>>>;
  let cli: CliAdapter;

  beforeEach(() => {
    output = vi.spyOn(console, 'log').mockImplementation(vi.fn());

    execute = vi.fn<(host: string, count: number) => Promise<NetworkMetrics>>();

    const networkProbe: NetworkProbeInterface = {
      probe: vi.fn(),
    };

    const useCase = new MeasureLatencyUseCase(networkProbe);

    vi.spyOn(useCase, 'execute').mockImplementation(execute);

    cli = new CliAdapter('game-route-optimizer', '0.1.0', useCase);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default command', () => {
    it('should display application information without arguments', async () => {
      await cli.run();

      expect(output).toHaveBeenCalledWith('game-route-optimizer v0.1.0');
      expect(output).toHaveBeenCalledWith(expect.stringContaining('Operating system:'));
      expect(output).toHaveBeenCalledWith(expect.stringContaining('Architecture:'));
      expect(output).toHaveBeenCalledWith(expect.stringContaining('Node.js:'));
    });
  });

  describe('help command', () => {
    it.each(['--help', '-h'])('should display help using %s', async (argument) => {
      await cli.run([argument]);

      expect(output).toHaveBeenCalledWith('  measure <host> [--count <number>]');
    });
  });

  describe('measure command', () => {
    it('should use ten probes by default', async () => {
      execute.mockResolvedValue(new NetworkMetrics());

      await cli.run(['measure', '1.1.1.1']);

      expect(execute).toHaveBeenCalledWith('1.1.1.1', 10);
    });

    it('should accept a custom probe count', async () => {
      execute.mockResolvedValue(new NetworkMetrics());

      await cli.run(['measure', '1.1.1.1', '--count', '20']);

      expect(execute).toHaveBeenCalledWith('1.1.1.1', 20);
    });

    it('should display aggregated network metrics', async () => {
      const metrics = new NetworkMetrics();

      metrics.addMeasurement(new NetworkMeasurement('1.1.1.1', 10, new Date()));
      metrics.addMeasurement(new NetworkMeasurement('1.1.1.1', 20, new Date()));
      metrics.addMeasurement(new NetworkMeasurement('1.1.1.1', null, new Date()));

      execute.mockResolvedValue(metrics);

      await cli.run(['measure', '1.1.1.1', '--count', '3']);

      expect(output).toHaveBeenCalledWith('Average: 15.00 ms');
      expect(output).toHaveBeenCalledWith('Minimum: 10.00 ms');
      expect(output).toHaveBeenCalledWith('Maximum: 20.00 ms');
      expect(output).toHaveBeenCalledWith('Jitter: 10.00 ms');
      expect(output).toHaveBeenCalledWith('Probe loss: 33.33%');
    });

    it('should display unavailable latency metrics', async () => {
      const metrics = new NetworkMetrics();

      metrics.addMeasurement(new NetworkMeasurement('192.0.2.1', null, new Date()));

      execute.mockResolvedValue(metrics);

      await cli.run(['measure', '192.0.2.1', '--count', '1']);

      expect(output).toHaveBeenCalledWith('Average: N/A');
      expect(output).toHaveBeenCalledWith('Minimum: N/A');
      expect(output).toHaveBeenCalledWith('Maximum: N/A');
      expect(output).toHaveBeenCalledWith('Jitter: N/A');
      expect(output).toHaveBeenCalledWith('Probe loss: 100.00%');
    });

    it('should reject a missing host', async () => {
      await expect(cli.run(['measure'])).rejects.toThrow('A target host is required.');
    });

    it.each(['0', '-1', '1.5', 'abc', '9007199254740992'])(
      'should reject invalid probe count %s',
      async (count) => {
        await expect(cli.run(['measure', '1.1.1.1', '--count', count])).rejects.toThrow(
          'Probe count must be a positive safe integer.',
        );
      },
    );

    it('should reject unsupported measurement arguments', async () => {
      await expect(cli.run(['measure', '1.1.1.1', '--unknown'])).rejects.toThrow(
        'Invalid measurement arguments.',
      );
    });

    it('should propagate measurement failures', async () => {
      execute.mockRejectedValue(new Error('Network probe failed.'));

      await expect(cli.run(['measure', '1.1.1.1'])).rejects.toThrow('Network probe failed.');
    });
  });

  describe('unknown commands', () => {
    it('should reject an unknown command', async () => {
      await expect(cli.run(['unknown'])).rejects.toThrow('Unknown command: unknown');
    });
  });
});
