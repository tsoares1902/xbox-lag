import type { NetworkMeasurement } from '../../domain/value-objects/NetworkMeasurement.js';

/**
 * Defines the contract for network latency probes.
 */
export interface NetworkProbeInterface {
  /**
   * Performs a network probe against the specified host.
   *
   * @param {string} host Target hostname or IP address.
   * @returns {Promise<NetworkMeasurement>}
   */
  probe(host: string): Promise<NetworkMeasurement>;
}
