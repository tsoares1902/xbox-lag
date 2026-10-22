import { describe, expect, it } from 'vitest';

import { NetworkMetrics } from '../../../src/domain/entities/NetworkMetrics.js';
import { NetworkMeasurement } from '../../../src/domain/value-objects/NetworkMeasurement.js';

describe('NetworkMetrics', () => {
  /**
   * Creates a metrics instance with the provided latency samples.
   *
   * @param {(number | null)[]} latencies Latency samples in milliseconds.
   * @returns {NetworkMetrics}
   */
  const createMetrics = (latencies: (number | null)[]): NetworkMetrics => {
    const metrics = new NetworkMetrics();

    latencies.forEach((latency, index) => {
      metrics.addMeasurement(
        new NetworkMeasurement('1.1.1.1', latency, new Date(Date.UTC(2026, 9, 22, 12, 0, index))),
      );
    });

    return metrics;
  };

  describe('addMeasurement', () => {
    it('should add a measurement', () => {
      const metrics = createMetrics([10]);

      expect(metrics.getTotalMeasurements()).toBe(1);
    });

    it('should accumulate multiple measurements', () => {
      const metrics = createMetrics([10, 20, null]);

      expect(metrics.getTotalMeasurements()).toBe(3);
    });
  });

  describe('getTotalMeasurements', () => {
    it('should return zero when no measurements exist', () => {
      const metrics = createMetrics([]);

      expect(metrics.getTotalMeasurements()).toBe(0);
    });

    it('should return the total number of measurements', () => {
      const metrics = createMetrics([10, null, 20]);

      expect(metrics.getTotalMeasurements()).toBe(3);
    });
  });

  describe('getSuccessfulMeasurements', () => {
    it('should count successful measurements', () => {
      const metrics = createMetrics([10, null, 20, 0]);

      expect(metrics.getSuccessfulMeasurements()).toBe(3);
    });

    it('should return zero when all measurements fail', () => {
      const metrics = createMetrics([null, null]);

      expect(metrics.getSuccessfulMeasurements()).toBe(0);
    });
  });

  describe('getFailedMeasurements', () => {
    it('should count unanswered probes', () => {
      const metrics = createMetrics([10, null, 20, null]);

      expect(metrics.getFailedMeasurements()).toBe(2);
    });

    it('should return zero when all probes succeed', () => {
      const metrics = createMetrics([10, 20]);

      expect(metrics.getFailedMeasurements()).toBe(0);
    });
  });

  describe('getAverageLatency', () => {
    it('should calculate average latency', () => {
      const metrics = createMetrics([10, 20, 30]);

      expect(metrics.getAverageLatency()).toBe(20);
    });

    it('should ignore failed measurements', () => {
      const metrics = createMetrics([10, null, 30]);

      expect(metrics.getAverageLatency()).toBe(20);
    });

    it('should return null when no successful measurements exist', () => {
      const metrics = createMetrics([null, null]);

      expect(metrics.getAverageLatency()).toBeNull();
    });
  });

  describe('getMinimumLatency', () => {
    it('should return the lowest successful latency', () => {
      const metrics = createMetrics([30, 10, 20, null]);

      expect(metrics.getMinimumLatency()).toBe(10);
    });

    it('should return null when no successful measurements exist', () => {
      const metrics = createMetrics([null]);

      expect(metrics.getMinimumLatency()).toBeNull();
    });
  });

  describe('getMaximumLatency', () => {
    it('should return the highest successful latency', () => {
      const metrics = createMetrics([10, 30, 20, null]);

      expect(metrics.getMaximumLatency()).toBe(30);
    });

    it('should return null when no successful measurements exist', () => {
      const metrics = createMetrics([]);

      expect(metrics.getMaximumLatency()).toBeNull();
    });
  });

  describe('getJitter', () => {
    it('should calculate mean absolute latency variation', () => {
      const metrics = createMetrics([10, 20, 15]);

      expect(metrics.getJitter()).toBe(7.5);
    });

    it('should return zero for constant latency', () => {
      const metrics = createMetrics([10, 10, 10]);

      expect(metrics.getJitter()).toBe(0);
    });

    it('should ignore pairs containing failed probes', () => {
      const metrics = createMetrics([10, 20, null, 30, 40]);

      expect(metrics.getJitter()).toBe(10);
    });

    it('should return null when fewer than two consecutive probes succeed', () => {
      const metrics = createMetrics([10, null, 20]);

      expect(metrics.getJitter()).toBeNull();
    });

    it('should return null when no measurements exist', () => {
      const metrics = createMetrics([]);

      expect(metrics.getJitter()).toBeNull();
    });
  });

  describe('getPacketLossPercentage', () => {
    it('should calculate packet loss percentage', () => {
      const metrics = createMetrics([10, null, 20, null]);

      expect(metrics.getPacketLossPercentage()).toBe(50);
    });

    it('should return zero when all probes succeed', () => {
      const metrics = createMetrics([10, 20, 30]);

      expect(metrics.getPacketLossPercentage()).toBe(0);
    });

    it('should return 100 when all probes fail', () => {
      const metrics = createMetrics([null, null]);

      expect(metrics.getPacketLossPercentage()).toBe(100);
    });

    it('should return zero when no measurements exist', () => {
      const metrics = createMetrics([]);

      expect(metrics.getPacketLossPercentage()).toBe(0);
    });
  });
});
