/**
 * Represents the result of an individual network latency measurement.
 */
export class NetworkMeasurement {
  /**
   * Creates a network measurement.
   *
   * @param {string} host Target hostname or IP address.
   * @param {number | null} latencyMs Latency in milliseconds or null when no response is received.
   * @param {Date} timestamp Time when the measurement was performed.
   */
  constructor(
    public readonly host: string,
    public readonly latencyMs: number | null,
    public readonly timestamp: Date,
  ) {
    if (host.trim().length === 0) {
      throw new Error('Host cannot be empty.');
    }

    if (latencyMs !== null && (!Number.isFinite(latencyMs) || latencyMs < 0)) {
      throw new Error('Latency must be a finite, non-negative number.');
    }

    if (Number.isNaN(timestamp.getTime())) {
      throw new Error('Timestamp must be a valid date.');
    }
  }

  /**
   * Determines whether the measurement received a response.
   *
   * @returns {boolean}
   */
  isSuccessful(): boolean {
    return this.latencyMs !== null;
  }
}
