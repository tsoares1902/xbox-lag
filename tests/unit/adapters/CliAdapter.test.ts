import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliAdapter } from '../../../src/adapters/cli/CliAdapter.js';
import type { NetworkProbeInterface } from '../../../src/application/interfaces/NetworkProbeInterface.js';
import { MeasureLatencyUseCase } from '../../../src/application/use-cases/MeasureLatencyUseCase.js';
import { NetworkMetrics } from '../../../src/domain/entities/NetworkMetrics.js';
import { NetworkMeasurement } from '../../../src/domain/value-objects/NetworkMeasurement.js';
import { MeasurementCancelledError } from '../../../src/application/use-cases/MeasurementCancelledError.js';

describe('CliAdapter', () => {
  let output: ReturnType<typeof vi.fn<typeof console.log>>;
  let execute: ReturnType<typeof vi.fn<MeasureLatencyUseCase['execute']>>;
  let cli: CliAdapter;

  /**
   * Creates a network measurement for testing.
   *
   * @param {number | null} latencyMs Measured latency or null for an unanswered probe.
   * @param {string} host Target hostname or IP address.
   * @returns {NetworkMeasurement} Network measurement for testing.
   */
  function createMeasurement(
    latencyMs: number | null,
    host: string = '1.1.1.1',
  ): NetworkMeasurement {
    return new NetworkMeasurement(host, latencyMs, new Date('2026-10-22T12:00:00.000Z'));
  }

  beforeEach(() => {
    output = vi.fn<typeof console.log>();
    vi.spyOn(console, 'log').mockImplementation(output);

    execute = vi.fn<MeasureLatencyUseCase['execute']>();

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

      expect(output).toHaveBeenCalledWith(
        '  measure <host> [--count <number>] [--interval <milliseconds>]',
      );
    });
  });

  describe('measure command', () => {
    it('should show partial metrics and exit with 130 on SIGINT', async () => {
      const previousExitCode = process.exitCode;
      const listeners = process.listeners('SIGINT');
      const metrics = new NetworkMetrics();
      metrics.addMeasurement(createMeasurement(10));
      metrics.addMeasurement(createMeasurement(20));
      metrics.addMeasurement(createMeasurement(null));
      execute.mockImplementation(async (_host, _count, options) => {
        if (typeof options !== 'object') throw new Error('Expected measurement options.');
        process.emit('SIGINT');
        expect(options.signal?.aborted).toBe(true);
        throw new MeasurementCancelledError(metrics);
      });

      try {
        await cli.run(['measure', '1.1.1.1']);

        expect(process.exitCode).toBe(130);
        expect(output).toHaveBeenCalledWith('Partial Summary');
        expect(output).toHaveBeenCalledWith('Completed: 3/10');
        expect(output).toHaveBeenCalledWith('Average: 15.00 ms');
        expect(output).toHaveBeenCalledWith('Minimum: 10.00 ms');
        expect(output).toHaveBeenCalledWith('Maximum: 20.00 ms');
        expect(output).toHaveBeenCalledWith('Jitter: 10.00 ms');
        expect(output).toHaveBeenCalledWith('Probe loss: 33.33%');
        expect(process.listeners('SIGINT')).toEqual(listeners);
      } finally {
        process.exitCode = previousExitCode;
      }
    });

    it('should show unavailable metrics when cancelled without completed probes', async () => {
      execute.mockRejectedValue(new MeasurementCancelledError(new NetworkMetrics()));

      await cli.run(['measure', '1.1.1.1']);

      expect(output).toHaveBeenCalledWith('Partial Summary');
      expect(output).toHaveBeenCalledWith('Completed: 0/10');
      for (const metric of ['Average', 'Minimum', 'Maximum', 'Jitter', 'Probe loss']) {
        expect(output).toHaveBeenCalledWith(`${metric}: N/A`);
      }
    });

    it.each([false, true])(
      'should restore signal listeners after execution with failure %s',
      async (fails) => {
        const listeners = process.listeners('SIGINT');
        const failure = new Error('Network failure');
        if (fails) {
          execute.mockRejectedValue(failure);
          await expect(cli.run(['measure', '1.1.1.1'])).rejects.toBe(failure);
        } else {
          execute.mockResolvedValue(new NetworkMetrics());
          await cli.run(['measure', '1.1.1.1']);
        }

        expect(process.listeners('SIGINT')).toEqual(listeners);
      },
    );

    it('should use ten probes by default', async () => {
      execute.mockResolvedValue(new NetworkMetrics());

      await cli.run(['measure', '1.1.1.1']);

      expect(execute).toHaveBeenCalledWith(
        '1.1.1.1',
        10,
        expect.objectContaining({
          onProgress: expect.any(Function),
          intervalMs: 1000,
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('should accept a custom probe count', async () => {
      execute.mockResolvedValue(new NetworkMetrics());

      await cli.run(['measure', '1.1.1.1', '--count', '20']);

      expect(execute).toHaveBeenCalledWith(
        '1.1.1.1',
        20,
        expect.objectContaining({
          onProgress: expect.any(Function),
          intervalMs: 1000,
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it.each([
      ['--count', '3', '--interval', '250'],
      ['--interval', '250', '--count', '3'],
    ])('should accept count and interval options in order %j', async (...options) => {
      execute.mockResolvedValue(new NetworkMetrics());

      await cli.run(['measure', '1.1.1.1', ...options]);

      expect(execute).toHaveBeenCalledWith(
        '1.1.1.1',
        3,
        expect.objectContaining({
          onProgress: expect.any(Function),
          intervalMs: 250,
          signal: expect.any(AbortSignal),
        }),
      );
      expect(output).toHaveBeenCalledWith('Interval: 250 ms');
    });

    it('should display aggregated network metrics', async () => {
      const metrics = new NetworkMetrics();

      metrics.addMeasurement(createMeasurement(10));
      metrics.addMeasurement(createMeasurement(20));
      metrics.addMeasurement(createMeasurement(null));

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

      metrics.addMeasurement(createMeasurement(null, '192.0.2.1'));

      execute.mockResolvedValue(metrics);

      await cli.run(['measure', '192.0.2.1', '--count', '1']);

      expect(output).toHaveBeenCalledWith('Average: N/A');
      expect(output).toHaveBeenCalledWith('Minimum: N/A');
      expect(output).toHaveBeenCalledWith('Maximum: N/A');
      expect(output).toHaveBeenCalledWith('Jitter: N/A');
      expect(output).toHaveBeenCalledWith('Probe loss: 100.00%');
    });

    describe('progress output', () => {
      it('should display successful measurements progressively', async () => {
        const measurements = [createMeasurement(10), createMeasurement(20)];
        const metrics = new NetworkMetrics();

        measurements.forEach((measurement) => {
          metrics.addMeasurement(measurement);
        });

        execute.mockImplementation(async (_host, _count, options) => {
          const onProgress = typeof options === 'function' ? options : options?.onProgress;
          measurements.forEach((measurement, index) => {
            onProgress?.(measurement, index + 1, measurements.length);
          });

          return metrics;
        });

        await cli.run(['measure', '1.1.1.1', '--count', '2']);

        expect(output).toHaveBeenCalledWith('[1/2] Latency: 10.00 ms');
        expect(output).toHaveBeenCalledWith('[2/2] Latency: 20.00 ms');
      });

      it('should display unanswered measurements as timeouts', async () => {
        const measurement = createMeasurement(null);
        const metrics = new NetworkMetrics();

        metrics.addMeasurement(measurement);

        execute.mockImplementation(async (_host, _count, options) => {
          const onProgress = typeof options === 'function' ? options : options?.onProgress;
          onProgress?.(measurement, 1, 1);

          return metrics;
        });

        await cli.run(['measure', '1.1.1.1', '--count', '1']);

        expect(output).toHaveBeenCalledWith('[1/1] Timeout');
      });

      it('should display the summary after all progress messages', async () => {
        const measurement = createMeasurement(15);
        const metrics = new NetworkMetrics();

        metrics.addMeasurement(measurement);

        execute.mockImplementation(async (_host, _count, options) => {
          const onProgress = typeof options === 'function' ? options : options?.onProgress;
          onProgress?.(measurement, 1, 1);

          return metrics;
        });

        await cli.run(['measure', '1.1.1.1', '--count', '1']);

        const messages = output.mock.calls.map(([message]) => message);

        const progressIndex = messages.indexOf('[1/1] Latency: 15.00 ms');
        const summaryIndex = messages.indexOf('Summary');
        const averageIndex = messages.indexOf('Average: 15.00 ms');

        expect(progressIndex).toBeGreaterThanOrEqual(0);
        expect(summaryIndex).toBeGreaterThan(progressIndex);
        expect(averageIndex).toBeGreaterThan(summaryIndex);
      });

      it('should provide a progress callback to the use case', async () => {
        execute.mockResolvedValue(new NetworkMetrics());

        await cli.run(['measure', '1.1.1.1', '--count', '2']);

        const options = execute.mock.calls[0]?.[2];
        const callback = typeof options === 'function' ? options : options?.onProgress;

        expect(callback).toEqual(expect.any(Function));
      });
    });

    describe('input validation', () => {
      it.each(['0', '-1', '1.5', 'abc', '2147483648', '9007199254740992'])(
        'should reject invalid probe interval %s',
        async (interval) => {
          await expect(cli.run(['measure', '1.1.1.1', '--interval', interval])).rejects.toThrow(
            'Probe interval must be a positive integer within the timer limit.',
          );

          expect(execute).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['--interval'],
        ['--count'],
        ['--interval', '250', '--interval', '500'],
        ['--count', '2', '--count', '3'],
      ])('should reject missing or duplicate options %j', async (...options) => {
        await expect(cli.run(['measure', '1.1.1.1', ...options])).rejects.toThrow(
          'Invalid measurement arguments.',
        );

        expect(execute).not.toHaveBeenCalled();
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
    });

    describe('error propagation', () => {
      it('should propagate measurement failures', async () => {
        execute.mockRejectedValue(new Error('Network probe failed.'));

        await expect(cli.run(['measure', '1.1.1.1'])).rejects.toThrow('Network probe failed.');
      });
    });
  });

  describe('unknown commands', () => {
    it('should reject an unknown command', async () => {
      await expect(cli.run(['unknown'])).rejects.toThrow('Unknown command: unknown');
    });
  });
});
