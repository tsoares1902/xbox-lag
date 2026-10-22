import { describe, expect, it } from 'vitest';

import { NetworkMeasurement } from '../../../src/domain/value-objects/NetworkMeasurement.js';

describe('NetworkMeasurement', () => {
  /**
   * Creates a network measurement for testing.
   *
   * @param {string} host Target hostname or IP address.
   * @param {number | null} latencyMs Latency in milliseconds.
   * @param {Date} timestamp Measurement timestamp.
   * @returns {NetworkMeasurement}
   */
  const createMeasurement = (
    host: string = '1.1.1.1',
    latencyMs: number | null = 10,
    timestamp: Date = new Date('2026-10-22T12:00:00.000Z'),
  ): NetworkMeasurement => new NetworkMeasurement(host, latencyMs, timestamp);

  describe('constructor', () => {
    it('should create a valid network measurement', () => {
      const measurement = createMeasurement();

      expect(measurement.host).toBe('1.1.1.1');
      expect(measurement.latencyMs).toBe(10);
      expect(measurement.timestamp).toEqual(new Date('2026-10-22T12:00:00.000Z'));
    });

    it('should accept zero latency', () => {
      const measurement = createMeasurement('1.1.1.1', 0);

      expect(measurement.latencyMs).toBe(0);
    });

    it('should accept null latency', () => {
      const measurement = createMeasurement('1.1.1.1', null);

      expect(measurement.latencyMs).toBeNull();
    });
  });

  describe('validation', () => {
    it('should reject an empty host', () => {
      expect(() => createMeasurement('')).toThrow('Host cannot be empty.');
      expect(() => createMeasurement('   ')).toThrow('Host cannot be empty.');
    });

    it('should reject negative latency', () => {
      expect(() => createMeasurement('1.1.1.1', -1)).toThrow(
        'Latency must be a finite, non-negative number.',
      );
    });

    it('should reject infinite latency', () => {
      expect(() => createMeasurement('1.1.1.1', Infinity)).toThrow(
        'Latency must be a finite, non-negative number.',
      );

      expect(() => createMeasurement('1.1.1.1', -Infinity)).toThrow(
        'Latency must be a finite, non-negative number.',
      );
    });

    it('should reject NaN latency', () => {
      expect(() => createMeasurement('1.1.1.1', NaN)).toThrow(
        'Latency must be a finite, non-negative number.',
      );
    });

    it('should reject an invalid timestamp', () => {
      expect(() => createMeasurement('1.1.1.1', 10, new Date('invalid'))).toThrow(
        'Timestamp must be a valid date.',
      );
    });
  });

  describe('isSuccessful', () => {
    it('should return true when a response is received', () => {
      const measurement = createMeasurement('1.1.1.1', 15);

      expect(measurement.isSuccessful()).toBe(true);
    });

    it('should return false when no response is received', () => {
      const measurement = createMeasurement('1.1.1.1', null);

      expect(measurement.isSuccessful()).toBe(false);
    });

    it('should consider zero latency successful', () => {
      const measurement = createMeasurement('1.1.1.1', 0);

      expect(measurement.isSuccessful()).toBe(true);
    });
  });
});
