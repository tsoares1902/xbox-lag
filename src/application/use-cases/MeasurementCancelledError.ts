import type { NetworkMetrics } from '../../domain/entities/NetworkMetrics.js';

/**
 * Reports cancellation with the measurements completed so far.
 */
export class MeasurementCancelledError extends Error {
  /**
   * Creates a cancellation result.
   *
   * @param {NetworkMetrics} metrics Completed measurement metrics.
   * @param {unknown} cause Original cancellation reason.
   * @returns {MeasurementCancelledError} Cancellation error.
   */
  constructor(
    readonly metrics: NetworkMetrics,
    cause?: unknown,
  ) {
    super('Measurement cancelled.', { cause });
    this.name = 'MeasurementCancelledError';
  }
}
