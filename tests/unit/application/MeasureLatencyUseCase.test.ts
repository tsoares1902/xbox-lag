import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeasureLatencyUseCase } from '../../../src/application/use-cases/MeasureLatencyUseCase.js';
import { NetworkMeasurement } from '../../../src/domain/value-objects/NetworkMeasurement.js';

import type { NetworkProbeInterface } from '../../../src/application/interfaces/NetworkProbeInterface.js';

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
   * @returns {NetworkMeasurement}
   */
  function createMeasurement(
    latencyMs: number | null,
    targetHost: string = host,
  ): NetworkMeasurement {
    return new NetworkMeasurement(targetHost, latencyMs, new Date('2026-10-22T12:00:00.000Z'));
  }

  beforeEach(() => {
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
