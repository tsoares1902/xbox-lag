import { setTimeout as delay } from 'node:timers/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeasureLatencyUseCase } from '../../../src/application/use-cases/MeasureLatencyUseCase.js';
import { NetworkMeasurement } from '../../../src/domain/value-objects/NetworkMeasurement.js';

import type { NetworkProbeInterface } from '../../../src/application/interfaces/NetworkProbeInterface.js';
import type { MeasurementProgressCallback } from '../../../src/application/use-cases/MeasureLatencyUseCase.js';

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

describe('MeasureLatencyUseCase', () => {
  const host = '1.1.1.1';

  let networkProbe: NetworkProbeInterface;
  let useCase: MeasureLatencyUseCase;
  let probeMock: ReturnType<typeof vi.fn<NetworkProbeInterface['probe']>>;

  /**
   * Creates a network measurement for testing.
   *
   * @param {number | null} latencyMs Measured latency or null for an unanswered probe.
   * @param {string} targetHost Target hostname or IP address.
   * @returns {NetworkMeasurement} Network measurement for testing.
   */
  function createMeasurement(
    latencyMs: number | null,
    targetHost: string = host,
  ): NetworkMeasurement {
    return new NetworkMeasurement(targetHost, latencyMs, new Date('2026-10-22T12:00:00.000Z'));
  }

  beforeEach(() => {
    vi.mocked(delay).mockClear();
    probeMock = vi.fn<NetworkProbeInterface['probe']>();

    networkProbe = {
      probe: probeMock,
    };

    useCase = new MeasureLatencyUseCase(networkProbe);
  });

  describe('constructor', () => {
    it('should create an instance with a network probe', () => {
      expect(useCase).toBeInstanceOf(MeasureLatencyUseCase);
    });
  });

  describe('execute', () => {
    describe('probe interval', () => {
      it('should wait one second between probes by default', async () => {
        probeMock.mockResolvedValue(createMeasurement(10));

        await useCase.execute(host, 3);

        expect(delay).toHaveBeenCalledTimes(2);
        expect(delay).toHaveBeenNthCalledWith(1, 1000);
        expect(delay).toHaveBeenNthCalledWith(2, 1000);
      });

      it('should wait for the custom interval between probes', async () => {
        const events: string[] = [];
        probeMock.mockImplementation(async () => {
          events.push('probe');
          return createMeasurement(10);
        });
        vi.mocked(delay).mockImplementation(async () => {
          events.push('delay');
        });

        try {
          await useCase.execute(host, 3, undefined, 250);

          expect(events).toEqual(['probe', 'delay', 'probe', 'delay', 'probe']);
          expect(delay).toHaveBeenCalledTimes(2);
          expect(delay).toHaveBeenNthCalledWith(1, 250);
          expect(delay).toHaveBeenNthCalledWith(2, 250);
        } finally {
          vi.mocked(delay).mockResolvedValue(undefined);
        }
      });

      it('should not wait after a single probe', async () => {
        probeMock.mockResolvedValue(createMeasurement(10));

        await useCase.execute(host, 1);

        expect(delay).not.toHaveBeenCalled();
      });

      it.each([0, -1, 1.5, Number.NaN, Infinity, 2147483648])(
        'should reject invalid probe interval %s',
        async (intervalMs) => {
          await expect(useCase.execute(host, 3, undefined, intervalMs)).rejects.toThrow(
            'Probe interval must be a positive integer within the timer limit.',
          );

          expect(probeMock).not.toHaveBeenCalled();
          expect(delay).not.toHaveBeenCalled();
        },
      );
    });

    describe('successful probes', () => {
      it('should execute the requested number of probes', async () => {
        probeMock.mockResolvedValue(createMeasurement(10));

        const metrics = await useCase.execute(host, 3);

        expect(probeMock).toHaveBeenCalledTimes(3);
        expect(metrics.getTotalMeasurements()).toBe(3);
        expect(metrics.getSuccessfulMeasurements()).toBe(3);
      });

      it('should pass the requested host to every probe', async () => {
        probeMock.mockResolvedValue(createMeasurement(10));

        await useCase.execute(host, 3);

        expect(probeMock).toHaveBeenNthCalledWith(1, host);
        expect(probeMock).toHaveBeenNthCalledWith(2, host);
        expect(probeMock).toHaveBeenNthCalledWith(3, host);
      });

      it('should aggregate latency metrics', async () => {
        probeMock
          .mockResolvedValueOnce(createMeasurement(10))
          .mockResolvedValueOnce(createMeasurement(20))
          .mockResolvedValueOnce(createMeasurement(30));

        const metrics = await useCase.execute(host, 3);

        expect(metrics.getAverageLatency()).toBe(20);
        expect(metrics.getMinimumLatency()).toBe(10);
        expect(metrics.getMaximumLatency()).toBe(30);
        expect(metrics.getJitter()).toBe(10);
        expect(metrics.getPacketLossPercentage()).toBe(0);
      });

      it('should execute probes sequentially', async () => {
        const events: string[] = [];

        probeMock.mockImplementation(async () => {
          events.push('start');

          await Promise.resolve();

          events.push('end');

          return createMeasurement(10);
        });

        await useCase.execute(host, 2);

        expect(events).toEqual(['start', 'end', 'start', 'end']);
      });

      it('should accept a single probe', async () => {
        probeMock.mockResolvedValue(createMeasurement(15));

        const metrics = await useCase.execute(host, 1);

        expect(metrics.getTotalMeasurements()).toBe(1);
        expect(metrics.getAverageLatency()).toBe(15);
        expect(metrics.getJitter()).toBeNull();
      });
    });

    describe('unanswered probes', () => {
      it('should count unanswered probes as failed measurements', async () => {
        probeMock
          .mockResolvedValueOnce(createMeasurement(10))
          .mockResolvedValueOnce(createMeasurement(null))
          .mockResolvedValueOnce(createMeasurement(20));

        const metrics = await useCase.execute(host, 3);

        expect(metrics.getTotalMeasurements()).toBe(3);
        expect(metrics.getSuccessfulMeasurements()).toBe(2);
        expect(metrics.getFailedMeasurements()).toBe(1);
        expect(metrics.getPacketLossPercentage()).toBeCloseTo(100 / 3);
      });

      it('should calculate complete probe loss', async () => {
        probeMock.mockResolvedValue(createMeasurement(null));

        const metrics = await useCase.execute(host, 3);

        expect(metrics.getFailedMeasurements()).toBe(3);
        expect(metrics.getPacketLossPercentage()).toBe(100);
        expect(metrics.getAverageLatency()).toBeNull();
      });

      it('should not calculate jitter across unanswered probes', async () => {
        probeMock
          .mockResolvedValueOnce(createMeasurement(10))
          .mockResolvedValueOnce(createMeasurement(null))
          .mockResolvedValueOnce(createMeasurement(30));

        const metrics = await useCase.execute(host, 3);

        expect(metrics.getJitter()).toBeNull();
      });
    });

    describe('progress callback', () => {
      it('should invoke the callback after each measurement', async () => {
        const measurements = [createMeasurement(10), createMeasurement(20), createMeasurement(30)];

        const onProgress = vi.fn<MeasurementProgressCallback>();

        measurements.forEach((measurement) => {
          probeMock.mockResolvedValueOnce(measurement);
        });

        await useCase.execute(host, 3, onProgress);

        expect(onProgress).toHaveBeenCalledTimes(3);
        expect(onProgress).toHaveBeenNthCalledWith(1, measurements[0], 1, 3);
        expect(onProgress).toHaveBeenNthCalledWith(2, measurements[1], 2, 3);
        expect(onProgress).toHaveBeenNthCalledWith(3, measurements[2], 3, 3);
      });

      it('should report unanswered probes to the callback', async () => {
        const measurement = createMeasurement(null);
        const onProgress = vi.fn<MeasurementProgressCallback>();

        probeMock.mockResolvedValue(measurement);

        await useCase.execute(host, 1, onProgress);

        expect(onProgress).toHaveBeenCalledExactlyOnceWith(measurement, 1, 1);
      });

      it('should invoke the callback after the probe completes', async () => {
        const events: string[] = [];
        const onProgress = vi.fn<MeasurementProgressCallback>(() => {
          events.push('progress');
        });

        probeMock.mockImplementation(async () => {
          events.push('probe');

          return createMeasurement(10);
        });

        await useCase.execute(host, 2, onProgress);

        expect(events).toEqual(['probe', 'progress', 'probe', 'progress']);
      });

      it('should work without a progress callback', async () => {
        probeMock.mockResolvedValue(createMeasurement(10));

        const metrics = await useCase.execute(host, 2);

        expect(metrics.getTotalMeasurements()).toBe(2);
        expect(metrics.getAverageLatency()).toBe(10);
      });

      it('should not report a measurement from another host', async () => {
        const onProgress = vi.fn<MeasurementProgressCallback>();

        probeMock.mockResolvedValue(createMeasurement(10, '8.8.8.8'));

        await expect(useCase.execute(host, 1, onProgress)).rejects.toThrow(
          'Probe result host does not match the requested host.',
        );

        expect(onProgress).not.toHaveBeenCalled();
      });

      it('should not invoke the callback when validation fails', async () => {
        const onProgress = vi.fn<MeasurementProgressCallback>();

        await expect(useCase.execute('', 3, onProgress)).rejects.toThrow('Host cannot be empty.');

        expect(onProgress).not.toHaveBeenCalled();
        expect(probeMock).not.toHaveBeenCalled();
      });
    });

    describe('input validation', () => {
      it('should reject an empty host', async () => {
        await expect(useCase.execute('', 3)).rejects.toThrow('Host cannot be empty.');

        expect(probeMock).not.toHaveBeenCalled();
      });

      it('should reject a whitespace-only host', async () => {
        await expect(useCase.execute('   ', 3)).rejects.toThrow('Host cannot be empty.');

        expect(probeMock).not.toHaveBeenCalled();
      });

      it.each([0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
        'should reject invalid probe count %s',
        async (count) => {
          await expect(useCase.execute(host, count)).rejects.toThrow(
            'Probe count must be a positive safe integer.',
          );

          expect(probeMock).not.toHaveBeenCalled();
        },
      );
    });

    describe('probe result validation', () => {
      it('should reject measurements from another host', async () => {
        probeMock.mockResolvedValue(createMeasurement(10, '8.8.8.8'));

        await expect(useCase.execute(host, 1)).rejects.toThrow(
          'Probe result host does not match the requested host.',
        );
      });

      it('should stop when a measurement belongs to another host', async () => {
        probeMock
          .mockResolvedValueOnce(createMeasurement(10))
          .mockResolvedValueOnce(createMeasurement(20, '8.8.8.8'));

        await expect(useCase.execute(host, 3)).rejects.toThrow(
          'Probe result host does not match the requested host.',
        );

        expect(probeMock).toHaveBeenCalledTimes(2);
      });
    });

    describe('error propagation', () => {
      it('should propagate network probe errors', async () => {
        const error = new Error('Network probe failed.');

        probeMock.mockRejectedValue(error);

        await expect(useCase.execute(host, 3)).rejects.toBe(error);

        expect(probeMock).toHaveBeenCalledTimes(1);
      });

      it('should stop executing probes after an error', async () => {
        probeMock
          .mockResolvedValueOnce(createMeasurement(10))
          .mockRejectedValueOnce(new Error('Network probe failed.'));

        await expect(useCase.execute(host, 5)).rejects.toThrow('Network probe failed.');

        expect(probeMock).toHaveBeenCalledTimes(2);
      });
    });
  });
});
