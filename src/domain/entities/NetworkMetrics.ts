import type { NetworkMeasurement } from '../value-objects/NetworkMeasurement.js';

/**
 * Aggregates network measurements and calculates diagnostic metrics.
 */
export class NetworkMetrics {
  private readonly measurements: NetworkMeasurement[] = [];

  /**
   * Adds a network measurement.
   *
   * @param {NetworkMeasurement} measurement Measurement to add.
   * @returns {void}
   */
  addMeasurement(measurement: NetworkMeasurement): void {
    this.measurements.push(measurement);
  }

  /**
   * Returns the total number of measurements.
   *
   * @returns {number}
   */
  getTotalMeasurements(): number {
    return this.measurements.length;
  }

  /**
   * Returns the number of successful measurements.
   *
   * @returns {number}
   */
  getSuccessfulMeasurements(): number {
    return this.getSuccessfulLatencies().length;
  }

  /**
   * Returns the number of failed measurements.
   *
   * @returns {number}
   */
  getFailedMeasurements(): number {
    return this.getTotalMeasurements() - this.getSuccessfulMeasurements();
  }

  /**
   * Calculates the average latency of successful measurements.
   *
   * @returns {number | null}
   */
  getAverageLatency(): number | null {
    const latencies = this.getSuccessfulLatencies();

    if (latencies.length === 0) {
      return null;
    }

    const total = latencies.reduce((sum, latency) => sum + latency, 0);

    return total / latencies.length;
  }

  /**
   * Returns the minimum successful latency.
   *
   * @returns {number | null}
   */
  getMinimumLatency(): number | null {
    const latencies = this.getSuccessfulLatencies();

    if (latencies.length === 0) {
      return null;
    }

    return Math.min(...latencies);
  }

  /**
   * Returns the maximum successful latency.
   *
   * @returns {number | null}
   */
  getMaximumLatency(): number | null {
    const latencies = this.getSuccessfulLatencies();

    if (latencies.length === 0) {
      return null;
    }

    return Math.max(...latencies);
  }

  /**
   * Calculates the mean absolute latency variation between consecutive successful probes.
   *
   * @returns {number | null}
   */
  getJitter(): number | null {
    let totalVariation = 0;
    let validPairs = 0;

    for (let index = 1; index < this.measurements.length; index++) {
      const previous = this.measurements[index - 1];
      const current = this.measurements[index];

      if (
        previous === undefined ||
        current === undefined ||
        previous.latencyMs === null ||
        current.latencyMs === null
      ) {
        continue;
      }

      totalVariation += Math.abs(current.latencyMs - previous.latencyMs);

      validPairs++;
    }

    if (validPairs === 0) {
      return null;
    }

    return totalVariation / validPairs;
  }

  /**
   * Calculates the percentage of unanswered network probes.
   *
   * @returns {number}
   */
  getPacketLossPercentage(): number {
    const total = this.getTotalMeasurements();

    if (total === 0) {
      return 0;
    }

    return (this.getFailedMeasurements() / total) * 100;
  }

  /**
   * Returns latency values from successful measurements.
   *
   * @returns {number[]}
   */
  private getSuccessfulLatencies(): number[] {
    return this.measurements
      .map((measurement) => measurement.latencyMs)
      .filter((latency): latency is number => latency !== null);
  }
}
