import { setTimeout as delay } from 'node:timers/promises';

import { NetworkMetrics } from '../../domain/entities/NetworkMetrics.js';
import type { NetworkMeasurement } from '../../domain/value-objects/NetworkMeasurement.js';
import type { NetworkProbeInterface } from '../interfaces/NetworkProbeInterface.js';
import { MeasurementCancelledError } from './MeasurementCancelledError.js';

export type MeasurementProgressCallback = (
  measurement: NetworkMeasurement,
  index: number,
  total: number,
) => void;

export interface MeasurementOptions {
  onProgress?: MeasurementProgressCallback;
  intervalMs?: number;
  signal?: AbortSignal;
}

/**
 * Executes network latency probes and aggregates their results.
 */
export class MeasureLatencyUseCase {
  /**
   * Creates the latency measurement use case.
   *
   * @param {NetworkProbeInterface} networkProbe Network probe implementation.
   */
  constructor(private readonly networkProbe: NetworkProbeInterface) {}

  /**
   * Executes sequential network probes against a target host.
   *
   * @param {string} host Target hostname or IP address.
   * @param {number} count Number of probes to execute.
   * @param {MeasurementOptions | MeasurementProgressCallback} options Measurement options or legacy callback.
   * @param {number} intervalMs Delay between probes in milliseconds.
   * @returns {Promise<NetworkMetrics>} Aggregated network metrics.
   */
  async execute(
    host: string,
    count: number,
    options?: MeasurementOptions | MeasurementProgressCallback,
    intervalMs: number = 1000,
  ): Promise<NetworkMetrics> {
    const {
      onProgress,
      signal,
      intervalMs: configuredInterval,
    } = typeof options === 'function' ? { onProgress: options } : (options ?? {});
    intervalMs = configuredInterval ?? intervalMs;
    if (host.trim().length === 0) {
      throw new Error('Host cannot be empty.');
    }

    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Probe count must be a positive safe integer.');
    }

    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > 2147483647) {
      throw new Error('Probe interval must be a positive integer within the timer limit.');
    }

    const metrics = new NetworkMetrics();

    try {
      signal?.throwIfAborted();
      for (let index = 0; index < count; index++) {
        signal?.throwIfAborted();
        const measurement = await (signal
          ? this.networkProbe.probe(host, signal)
          : this.networkProbe.probe(host));

        if (measurement.host !== host) {
          throw new Error('Probe result host does not match the requested host.');
        }

        metrics.addMeasurement(measurement);
        onProgress?.(measurement, index + 1, count);
        signal?.throwIfAborted();

        if (index < count - 1) {
          if (signal) {
            try {
              await delay(intervalMs, undefined, { signal });
            } catch (error) {
              if (
                signal.aborted &&
                error instanceof Error &&
                Object.is(error.cause, signal.reason) &&
                'code' in error &&
                error.code === 'ABORT_ERR'
              ) {
                throw signal.reason;
              }
              throw error;
            }
          } else {
            await delay(intervalMs);
          }
        }
      }
    } catch (error) {
      if (signal?.aborted && Object.is(error, signal.reason)) {
        throw new MeasurementCancelledError(metrics, signal.reason);
      }
      throw error;
    }

    return metrics;
  }
}
