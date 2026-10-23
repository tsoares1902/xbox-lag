import { execFile } from 'node:child_process';
import type { NetworkProbeInterface } from '../../application/interfaces/NetworkProbeInterface.js';
import { NetworkMeasurement } from '../../domain/value-objects/NetworkMeasurement.js';

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
   * @param {AbortSignal} signal Optional cancellation signal.
   * @returns {Promise<NetworkMeasurement>} Network measurement result.
   */
  async probe(host: string, signal?: AbortSignal): Promise<NetworkMeasurement> {
    signal?.throwIfAborted();
    if (process.platform !== 'win32') {
      throw new Error('Windows ICMP adapter requires Windows.');
    }

    if (host.trim().length === 0) {
      throw new Error('Host cannot be empty.');
    }

    const args = ['-n', '1', '-w', String(this.timeoutMs), host];

    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        let processError: Error | null = null;
        let output = '';
        let completed = false;
        let cancelling = false;
        let settled = false;
        let exited = false;
        let closed = false;
        let terminationTimer: ReturnType<typeof setTimeout> | undefined;
        const child = execFile(
          'ping.exe',
          args,
          {
            windowsHide: true,
            timeout: this.timeoutMs + 2000,
          },
          (error, stdout) => {
            if (settled) return;
            completed = true;
            if (
              error &&
              !(
                cancelling &&
                ((error.killed &&
                  error.code == null &&
                  (error.signal === 'SIGTERM' || error.signal === 'SIGKILL')) ||
                  (error.code === 1 && this.isTimeoutOutput(stdout)))
              )
            ) {
              processError ??= Object.assign(error, { stdout });
            }
            output = stdout;
          },
        );
        const cleanup = (): void => {
          clearTimeout(terminationTimer);
          clearTimeout(operationTimer);
          signal?.removeEventListener('abort', abort);
          child.removeListener('error', onError);
          child.removeListener('close', onClose);
          child.removeListener('exit', onExit);
        };
        const finish = (terminationError?: Error): void => {
          if (settled) return;
          settled = true;
          cleanup();
          if (processError || terminationError) {
            reject(processError ?? terminationError);
          } else if (cancelling) {
            reject(signal?.reason);
          } else {
            resolve(output);
          }
        };
        const kill = (killSignal: NodeJS.Signals): void => {
          if (exited || closed || child.exitCode != null || child.signalCode != null) return;
          try {
            const sent = child.kill(killSignal);
            if (!sent && child.exitCode == null && child.signalCode == null) {
              processError ??= new Error('Failed to terminate ping.exe.');
            }
          } catch (error) {
            processError ??= error instanceof Error ? error : new Error(String(error));
          }
        };
        const release = (): void => {
          for (const stream of [child.stdin, child.stdout, child.stderr]) {
            try {
              stream?.destroy();
            } catch (error) {
              processError ??= error instanceof Error ? error : new Error(String(error));
            }
          }
          try {
            child.unref();
          } catch (error) {
            processError ??= error instanceof Error ? error : new Error(String(error));
          }
          finish(new Error('ping.exe did not close after termination.'));
        };
        const abort = (): void => {
          if (
            settled ||
            completed ||
            exited ||
            closed ||
            child.exitCode != null ||
            child.signalCode != null ||
            cancelling
          )
            return;
          cancelling = true;
          kill('SIGTERM');
          if (settled || exited || closed) return;
          terminationTimer = setTimeout(() => {
            kill('SIGKILL');
            if (settled || exited || closed) return;
            terminationTimer = setTimeout(release, 1000);
          }, 1000);
        };
        const onError = (error: Error): void => {
          processError ??= error;
        };
        const onExit = (): void => {
          if (settled || closed || exited) return;
          exited = true;
          clearTimeout(terminationTimer);
          clearTimeout(operationTimer);
          terminationTimer = setTimeout(release, 1000);
        };
        const onClose = (): void => {
          if (settled || closed) return;
          closed = true;
          clearTimeout(terminationTimer);
          clearTimeout(operationTimer);
          queueMicrotask(() => {
            if (!completed && !cancelling && !processError) {
              processError = new Error('ping.exe closed without an execution result.');
            }
            finish();
          });
        };
        child.on('error', onError);
        child.once('exit', onExit);
        child.once('close', onClose);
        const operationTimer = setTimeout(() => {
          processError ??= new Error('ping.exe exceeded the execution deadline.');
          completed = false;
          if (child.exitCode != null || child.signalCode != null) {
            onExit();
          } else {
            abort();
          }
        }, this.timeoutMs + 4000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
          abort();
        }
      });

      return new NetworkMeasurement(host, this.parseLatency(stdout), new Date());
    } catch (error) {
      if (signal?.aborted && Object.is(error, signal.reason)) {
        throw error;
      }
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
