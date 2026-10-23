import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { NetworkProbeInterface } from '../../application/interfaces/NetworkProbeInterface.js';
import { NetworkMeasurement } from '../../domain/value-objects/NetworkMeasurement.js';

const execFileAsync = promisify(execFile);

/**
 * Executes ICMP latency probes using the Windows ping utility.
 */
export class WindowsIcmpAdapter implements NetworkProbeInterface {
  /**
   * Creates the Windows ICMP adapter.
   *
   * @param {number} timeoutMs Maximum wait time for each probe in milliseconds.
   */
  constructor(private readonly timeoutMs: number = 1000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Timeout must be a positive safe integer.');
    }
  }

  /**
   * Performs an ICMP probe against the specified host.
   *
   * @param {string} host Target hostname or IP address.
   * @returns {Promise<NetworkMeasurement>} Network measurement result.
   */
  async probe(host: string): Promise<NetworkMeasurement> {
    if (process.platform !== 'win32') {
      throw new Error('Windows ICMP adapter requires Windows.');
    }

    if (host.trim().length === 0) {
      throw new Error('Host cannot be empty.');
    }

    const args = ['-n', '1', '-w', String(this.timeoutMs), host];

    try {
      const { stdout } = await execFileAsync('ping.exe', args, {
        windowsHide: true,
        timeout: this.timeoutMs + 2000,
      });

      return new NetworkMeasurement(host, this.parseLatency(stdout), new Date());
    } catch (error) {
      if (!this.isPingFailure(error)) {
        throw error;
      }

      if (this.isTimeoutOutput(error.stdout)) {
        return new NetworkMeasurement(host, null, new Date());
      }

      throw error;
    }
  }

  /**
   * Extracts the latency from a successful Windows ping reply.
   *
   * @param {string} output Standard output from ping.exe.
   * @returns {number | null} Latency in milliseconds or null.
   */
  private parseLatency(output: string): number | null {
    const match = output.match(/\b(?:time|tempo)\s*(=|<)\s*(\d+(?:[.,]\d+)?)\s*ms\b/i);

    if (!match) {
      return null;
    }

    const value = Number(match[2]?.replace(',', '.'));

    if (!Number.isFinite(value)) {
      return null;
    }

    return match[1] === '<' ? value / 2 : value;
  }

  /**
   * Identifies a Windows ping timeout response.
   *
   * @param {string} output Standard output from ping.exe.
   * @returns {boolean} Whether the output indicates a timeout.
   */
  private isTimeoutOutput(output: string): boolean {
    return /request timed out\.|esgotado o tempo limite do pedido\./i.test(output);
  }

  /**
   * Identifies a ping process that exited with a numeric status.
   *
   * @param {unknown} error Process execution error.
   * @returns {error is Error & { stdout: string }} Whether the error contains ping output.
   */
  private isPingFailure(error: unknown): error is Error & { stdout: string } {
    return (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'number' &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    );
  }
}
