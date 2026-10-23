import { arch, platform, release } from 'node:os';

import type { MeasureLatencyUseCase } from '../../application/use-cases/MeasureLatencyUseCase.js';
import type { NetworkMetrics } from '../../domain/entities/NetworkMetrics.js';
import { MeasurementCancelledError } from '../../application/use-cases/MeasurementCancelledError.js';

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
    let intervalMs = 1000;

    const receivedOptions = new Set<string>();

    for (let index = 0; index < options.length; index += 2) {
      const option = options[index];
      const value = options[index + 1];

      if (
        option === undefined ||
        value === undefined ||
        !['--count', '--interval'].includes(option) ||
        receivedOptions.has(option)
      ) {
        throw new Error('Invalid measurement arguments.');
      }

      receivedOptions.add(option);

      if (!/^[1-9]\d*$/.test(value)) {
        if (option === '--count') {
          throw new Error('Probe count must be a positive safe integer.');
        }

        throw new Error('Probe interval must be a positive integer within the timer limit.');
      }

      const parsedValue = Number(value);

      if (option === '--count') {
        if (!Number.isSafeInteger(parsedValue)) {
          throw new Error('Probe count must be a positive safe integer.');
        }

        count = parsedValue;
      } else {
        if (!Number.isSafeInteger(parsedValue) || parsedValue > 2147483647) {
          throw new Error('Probe interval must be a positive integer within the timer limit.');
        }

        intervalMs = parsedValue;
      }
    }

    console.log('Xbox Lag — Network Diagnostics');
    console.log('');
    console.log(`Target: ${host}`);
    console.log(`Probes: ${count}`);
    console.log(`Interval: ${intervalMs} ms`);
    console.log('');

    const controller = new AbortController();
    const interrupt = (): void => {
      controller.abort();
      process.exitCode = 130;
    };
    process.on('SIGINT', interrupt);
    try {
      const metrics = await this.measureLatencyUseCase.execute(host, count, {
        onProgress: (measurement, index, total) => {
          const result =
            measurement.latencyMs === null
              ? 'Timeout'
              : `Latency: ${this.formatLatency(measurement.latencyMs)}`;

          console.log(`[${index}/${total}] ${result}`);
        },
        intervalMs,
        signal: controller.signal,
      });

      console.log('');
      console.log('Summary');
      this.printMetrics(metrics);
    } catch (error) {
      if (!(error instanceof MeasurementCancelledError)) {
        throw error;
      }
      console.log('');
      console.log('Partial Summary');
      console.log(`Completed: ${error.metrics.getTotalMeasurements()}/${count}`);
      this.printMetrics(error.metrics);
    } finally {
      process.removeListener('SIGINT', interrupt);
    }
  }

  /**
   * Displays the aggregated network metrics.
   *
   * @param {NetworkMetrics} metrics Aggregated network measurements.
   * @returns {void} Completion of output.
   */
  private printMetrics(metrics: NetworkMetrics): void {
    console.log(`Average: ${this.formatLatency(metrics.getAverageLatency())}`);
    console.log(`Minimum: ${this.formatLatency(metrics.getMinimumLatency())}`);
    console.log(`Maximum: ${this.formatLatency(metrics.getMaximumLatency())}`);
    console.log(`Jitter: ${this.formatLatency(metrics.getJitter())}`);
    console.log(
      `Probe loss: ${metrics.getTotalMeasurements() === 0 ? 'N/A' : `${metrics.getPacketLossPercentage().toFixed(2)}%`}`,
    );
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
   * @returns {void} Completion of output.
   */
  private printHelp(): void {
    console.log(`${this.name} v${this.version}`);
    console.log('');
    console.log('Usage:');
    console.log('  measure <host> [--count <number>] [--interval <milliseconds>]');
    console.log('');
    console.log('Commands:');
    console.log('  measure    Measure network latency and probe loss.');
    console.log('');
    console.log('Options:');
    console.log('  --count       Number of probes (default: 10).');
    console.log('  --interval    Delay between probes in milliseconds (default: 1000).');
    console.log('  --help        Display this help message.');
  }

  /**
   * Displays application and runtime environment information.
   *
   * @returns {void} Completion of output.
   */
  private printEnvironment(): void {
    console.log(`${this.name} v${this.version}`);
    console.log(`Operating system: ${platform()} ${release()}`);
    console.log(`Architecture: ${arch()}`);
    console.log(`Node.js: ${process.version}`);
  }
}
