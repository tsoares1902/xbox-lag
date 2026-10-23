import { arch, platform, release } from 'node:os';

import type { MeasureLatencyUseCase } from '../../application/use-cases/MeasureLatencyUseCase.js';
import type { NetworkMetrics } from '../../domain/entities/NetworkMetrics.js';

/**
 * Provides the command-line interface for the application.
 */
export class CliAdapter {
  /**
   * Creates the CLI adapter.
   *
   * @param {string} name Application package name.
   * @param {string} version Application package version.
   * @param {MeasureLatencyUseCase} measureLatencyUseCase Latency measurement use case.
   */
  constructor(
    private readonly name: string,
    private readonly version: string,
    private readonly measureLatencyUseCase: MeasureLatencyUseCase,
  ) {}

  /**
   * Executes the requested CLI command.
   *
   * @param {string[]} args Command-line arguments.
   * @returns {Promise<void>} Completion of the command.
   */
  async run(args: string[] = []): Promise<void> {
    const [command, ...options] = args;

    if (command === 'measure') {
      await this.measure(options);
      return;
    }

    if (command === '--help' || command === '-h') {
      this.printHelp();
      return;
    }

    if (command !== undefined) {
      throw new Error(`Unknown command: ${command}`);
    }

    this.printEnvironment();
  }

  /**
   * Executes latency measurements against a target host.
   *
   * @param {string[]} args Measurement command arguments.
   * @returns {Promise<void>} Completion of the measurements.
   */
  private async measure(args: string[]): Promise<void> {
    const [host, ...options] = args;

    if (host === undefined || host.startsWith('-')) {
      throw new Error('A target host is required.');
    }

    let count = 10;

    if (options.length > 0) {
      if (options.length !== 2 || options[0] !== '--count') {
        throw new Error('Invalid measurement arguments.');
      }

      const value = options[1];

      if (value === undefined || !/^[1-9]\d*$/.test(value)) {
        throw new Error('Probe count must be a positive safe integer.');
      }

      count = Number(value);

      if (!Number.isSafeInteger(count)) {
        throw new Error('Probe count must be a positive safe integer.');
      }
    }

    console.log('Xbox Lag — Network Diagnostics');
    console.log('');
    console.log(`Target: ${host}`);
    console.log(`Probes: ${count}`);
    console.log('');

    const metrics = await this.measureLatencyUseCase.execute(host, count);

    this.printMetrics(metrics);
  }

  /**
   * Displays the aggregated network metrics.
   *
   * @param {NetworkMetrics} metrics Aggregated network measurements.
   * @returns {void}
   */
  private printMetrics(metrics: NetworkMetrics): void {
    console.log(`Average: ${this.formatLatency(metrics.getAverageLatency())}`);
    console.log(`Minimum: ${this.formatLatency(metrics.getMinimumLatency())}`);
    console.log(`Maximum: ${this.formatLatency(metrics.getMaximumLatency())}`);
    console.log(`Jitter: ${this.formatLatency(metrics.getJitter())}`);
    console.log(`Probe loss: ${metrics.getPacketLossPercentage().toFixed(2)}%`);
  }

  /**
   * Formats a latency value for CLI output.
   *
   * @param {number | null} latency Latency in milliseconds.
   * @returns {string} Formatted latency.
   */
  private formatLatency(latency: number | null): string {
    return latency === null ? 'N/A' : `${latency.toFixed(2)} ms`;
  }

  /**
   * Displays the available commands.
   *
   * @returns {void}
   */
  private printHelp(): void {
    console.log(`${this.name} v${this.version}`);
    console.log('');
    console.log('Usage:');
    console.log('  measure <host> [--count <number>]');
    console.log('');
    console.log('Commands:');
    console.log('  measure    Measure network latency and probe loss.');
    console.log('');
    console.log('Options:');
    console.log('  --count    Number of probes (default: 10).');
    console.log('  --help     Display this help message.');
  }

  /**
   * Displays application and runtime environment information.
   *
   * @returns {void}
   */
  private printEnvironment(): void {
    console.log(`${this.name} v${this.version}`);
    console.log(`Operating system: ${platform()} ${release()}`);
    console.log(`Architecture: ${arch()}`);
    console.log(`Node.js: ${process.version}`);
  }
}
