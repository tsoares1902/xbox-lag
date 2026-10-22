import { NetworkMetrics } from '../../domain/entities/NetworkMetrics.js';
import type { NetworkProbeInterface } from '../interfaces/NetworkProbeInterface.js';

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
   * @returns {Promise<NetworkMetrics>}
   */
  async execute(host: string, count: number): Promise<NetworkMetrics> {
    if (host.trim().length === 0) {
      throw new Error('Host cannot be empty.');
    }

    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Probe count must be a positive safe integer.');
    }

    const metrics = new NetworkMetrics();

    for (let index = 0; index < count; index++) {
      const measurement = await this.networkProbe.probe(host);

      if (measurement.host !== host) {
        throw new Error('Probe result host does not match the requested host.');
      }

      metrics.addMeasurement(measurement);
    }

    return metrics;
  }
}
