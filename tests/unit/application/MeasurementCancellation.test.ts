import { setImmediate } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import { MeasureLatencyUseCase } from '../../../src/application/use-cases/MeasureLatencyUseCase.js';
import { MeasurementCancelledError } from '../../../src/application/use-cases/MeasurementCancelledError.js';
import { NetworkMeasurement } from '../../../src/domain/value-objects/NetworkMeasurement.js';
import type { NetworkProbeInterface } from '../../../src/application/interfaces/NetworkProbeInterface.js';

describe('Measurement cancellation', () => {
  it('should preserve an unrelated execution error named AbortError', async () => {
    const controller = new AbortController();
    const failure = Object.assign(new Error('Execution failed'), { name: 'AbortError' });
    const probe = vi.fn<NetworkProbeInterface['probe']>().mockImplementation(async () => {
      controller.abort('User stopped');
      throw failure;
    });

    await expect(
      new MeasureLatencyUseCase({ probe }).execute('1.1.1.1', 3, {
        signal: controller.signal,
      }),
    ).rejects.toBe(failure);
  });

  it.each(['Custom cancellation', { message: 'Stop' }, new Error('Stop'), Number.NaN])(
    'should handle custom cancellation reason %j during a probe',
    async (reason) => {
      const controller = new AbortController();
      const probe = vi.fn<NetworkProbeInterface['probe']>().mockImplementation(async () => {
        controller.abort(reason);
        throw reason;
      });

      await expect(
        new MeasureLatencyUseCase({ probe }).execute('1.1.1.1', 3, {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: 'MeasurementCancelledError', cause: reason });
    },
  );

  it('should handle a custom reason during the interval', async () => {
    const controller = new AbortController();
    const probe = vi
      .fn<NetworkProbeInterface['probe']>()
      .mockResolvedValue(new NetworkMeasurement('1.1.1.1', 12, new Date()));
    const result = new MeasureLatencyUseCase({ probe })
      .execute('1.1.1.1', 3, {
        signal: controller.signal,
        intervalMs: 2147483647,
      })
      .catch((error: unknown) => error);
    await setImmediate();
    controller.abort({ message: 'Stop now' });

    expect(await result).toBeInstanceOf(MeasurementCancelledError);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('should retain a naturally completed probe when abort occurs before its continuation', async () => {
    const controller = new AbortController();
    const measurement = new NetworkMeasurement('1.1.1.1', 12, new Date());
    const probe = vi.fn<NetworkProbeInterface['probe']>().mockImplementation(() => {
      const result = Promise.resolve(measurement);
      queueMicrotask(() => controller.abort());
      return result;
    });
    const result = await new MeasureLatencyUseCase({ probe })
      .execute('1.1.1.1', 3, {
        signal: controller.signal,
      })
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(MeasurementCancelledError);
    if (!(result instanceof MeasurementCancelledError)) throw new Error('Expected cancellation.');
    expect(result.metrics.getTotalMeasurements()).toBe(1);
    expect(result.metrics.getAverageLatency()).toBe(12);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('should cancel before the first probe', async () => {
    const controller = new AbortController();
    controller.abort();
    const probe = vi.fn<NetworkProbeInterface['probe']>();
    const useCase = new MeasureLatencyUseCase({ probe });

    await expect(
      useCase.execute('1.1.1.1', 3, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'MeasurementCancelledError',
      metrics: expect.objectContaining({}),
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('should immediately interrupt the interval and retain completed metrics', async () => {
    const controller = new AbortController();
    const probe = vi
      .fn<NetworkProbeInterface['probe']>()
      .mockResolvedValue(new NetworkMeasurement('1.1.1.1', 12, new Date()));
    const useCase = new MeasureLatencyUseCase({ probe });
    const result = useCase
      .execute('1.1.1.1', 3, {
        signal: controller.signal,
        intervalMs: 2147483647,
      })
      .catch((error: unknown) => error);

    await setImmediate();
    controller.abort();
    const error = await result;

    expect(error).toBeInstanceOf(MeasurementCancelledError);
    if (!(error instanceof MeasurementCancelledError)) throw new Error('Expected cancellation.');
    expect(error.metrics.getTotalMeasurements()).toBe(1);
    expect(error.metrics.getAverageLatency()).toBe(12);
    expect(error.metrics.getPacketLossPercentage()).toBe(0);
    expect(probe).toHaveBeenCalledExactlyOnceWith('1.1.1.1', controller.signal);
  });

  it('should exclude a cancelled probe and wait for its cleanup', async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const probe = vi.fn<NetworkProbeInterface['probe']>().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          finish = () => reject(controller.signal.reason);
        }),
    );
    const onProgress = vi.fn();
    let settled = false;
    const result = new MeasureLatencyUseCase({ probe })
      .execute('1.1.1.1', 3, {
        signal: controller.signal,
        onProgress,
      })
      .catch((error: unknown) => {
        settled = true;
        return error;
      });

    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    const error = await result;
    expect(error).toBeInstanceOf(MeasurementCancelledError);
    if (!(error instanceof MeasurementCancelledError)) throw new Error('Expected cancellation.');
    expect(error.metrics.getTotalMeasurements()).toBe(0);
    expect(error.metrics.getFailedMeasurements()).toBe(0);
    expect(onProgress).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('should stop after cancellation in the progress callback', async () => {
    const controller = new AbortController();
    const probe = vi
      .fn<NetworkProbeInterface['probe']>()
      .mockResolvedValue(new NetworkMeasurement('1.1.1.1', null, new Date()));
    const result = new MeasureLatencyUseCase({ probe }).execute('1.1.1.1', 3, {
      signal: controller.signal,
      onProgress: () => controller.abort('User cancelled'),
    });

    await expect(result).rejects.toBeInstanceOf(MeasurementCancelledError);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('should propagate network failures even if the signal is aborted', async () => {
    const controller = new AbortController();
    const failure = new Error('Network failure');
    const probe = vi.fn<NetworkProbeInterface['probe']>().mockImplementation(async () => {
      controller.abort();
      throw failure;
    });

    await expect(
      new MeasureLatencyUseCase({ probe }).execute('1.1.1.1', 3, {
        signal: controller.signal,
      }),
    ).rejects.toBe(failure);
  });
});
