import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile, type ChildProcess, type ExecFileException } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { WindowsIcmpAdapter } from '../../../src/infrastructure/network/WindowsIcmpAdapter.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);
const runMock = vi.fn<() => Promise<{ stdout: string; stderr: string }>>();
let child: ChildProcess;
let complete: (error: ExecFileException | null, stdout: string, stderr: string) => void;

describe('WindowsIcmpAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMock.mockReset();
    child = new EventEmitter() as ChildProcess;
    child.kill = vi.fn(() => true);
    child.unref = vi.fn();
    execFileMock.mockImplementation((...args) => {
      const callback = args[3] as (
        error: ExecFileException | null,
        stdout: string,
        stderr: string,
      ) => void;
      complete = callback;
      void runMock().then(
        ({ stdout, stderr }) => {
          callback(null, stdout, stderr);
          child.emit('close', 0);
        },
        (error: ExecFileException & { stdout?: string }) => {
          callback(error, error.stdout ?? '', '');
          child.emit('close', 1);
        },
      );
      return child;
    });
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should accept the default timeout', () => {
      expect(() => new WindowsIcmpAdapter()).not.toThrow();
    });

    it('should accept a positive timeout', () => {
      expect(() => new WindowsIcmpAdapter(2000)).not.toThrow();
    });

    it.each([0, -1, 1.5, NaN, Infinity])('should reject invalid timeout %s', (timeout) => {
      expect(() => new WindowsIcmpAdapter(timeout)).toThrow(
        'Timeout must be a positive safe integer.',
      );
    });
  });

  describe('probe', () => {
    it('should not turn timeout output received after cancellation into packet loss', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort('Stop');
      complete(Object.assign(new Error('Command failed'), { code: 1 }), 'Request timed out.', '');
      child.emit('close', 1);

      expect(await result).toBe('Stop');
    });

    it('should preserve a timeout completed before cancellation', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter().probe('1.1.1.1', controller.signal);
      child.emit('exit', 1);
      controller.abort();
      complete(Object.assign(new Error('Command failed'), { code: 1 }), 'Request timed out.', '');
      child.emit('close', 1);

      expect((await result).latencyMs).toBeNull();
      expect(child.kill).not.toHaveBeenCalled();
    });

    it.each(['exit-first', 'abort-first', 'close-first'])(
      'should settle once for event order %s',
      async (order) => {
        vi.useFakeTimers();
        runMock.mockImplementation(() => new Promise(() => {}));
        const controller = new AbortController();
        const settled = vi.fn();
        const result = new WindowsIcmpAdapter().probe('1.1.1.1', controller.signal).then(
          (measurement) => {
            settled();
            return measurement;
          },
          (error: unknown) => {
            settled();
            return error;
          },
        );
        if (order === 'abort-first') controller.abort('Stop');
        if (order === 'close-first') child.emit('close', 0);
        child.emit('exit', 0);
        complete(null, 'time=11ms', '');
        controller.abort('Stop');
        child.emit('close', 0);
        const value = await result;
        if (order === 'abort-first') expect(value).toBe('Stop');
        else expect(value).toMatchObject({ latencyMs: 11 });
        child.emit('close', 0);
        child.emit('exit', 0);
        complete(null, 'time=99ms', '');
        await vi.runAllTimersAsync();

        expect(settled).toHaveBeenCalledTimes(1);
        expect(child.kill).toHaveBeenCalledTimes(order === 'abort-first' ? 1 : 0);
        expect(child.listenerCount('exit')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it('should handle exit emitted synchronously by kill without scheduling another kill', async () => {
      vi.useFakeTimers();
      runMock.mockImplementation(() => new Promise(() => {}));
      vi.mocked(child.kill).mockImplementation(() => {
        child.emit('exit', null, 'SIGTERM');
        return true;
      });
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      child.emit('close');

      expect(await result).toBe(controller.signal.reason);
      await vi.runAllTimersAsync();
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should stop escalation after exit while waiting for close', async () => {
      vi.useFakeTimers();
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      child.emit('exit', null, 'SIGTERM');
      await vi.advanceTimersByTimeAsync(1000);

      expect(await result).toEqual(new Error('ping.exe did not close after termination.'));
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should bound a hung execution even without a cancellation signal', async () => {
      vi.useFakeTimers();
      runMock.mockImplementation(() => new Promise(() => {}));
      const result = new WindowsIcmpAdapter().probe('1.1.1.1').catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(7000);

      expect(await result).toEqual(new Error('ping.exe exceeded the execution deadline.'));
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should reject close without a result instead of inventing an ICMP timeout', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const result = new WindowsIcmpAdapter().probe('1.1.1.1');
      child.emit('close', 1);

      await expect(result).rejects.toThrow('ping.exe closed without an execution result.');
    });

    it('should preserve a buffer execution error even when marked killed', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const failure = Object.assign(new Error('Buffer exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        killed: true,
        signal: 'SIGTERM' as const,
      });
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      complete(failure, '', '');
      child.emit('close');

      expect(await result).toBe(failure);
    });

    it('should finish cleanup even if destroying a stream fails', async () => {
      vi.useFakeTimers();
      runMock.mockImplementation(() => new Promise(() => {}));
      const failure = new Error('Stream cleanup failed');
      const destroy = vi.fn();
      Object.assign(child, {
        stdout: {
          destroy: () => {
            throw failure;
          },
        },
        stderr: { destroy },
      });
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      await vi.advanceTimersByTimeAsync(2000);

      expect(await result).toBe(failure);
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
      'custom reason',
      { message: 'Stop now' },
      Object.assign(new Error('Timeout-shaped reason'), { code: 1, stdout: 'Request timed out.' }),
    ])('should preserve the cancellation reason %j without returning a timeout', async (reason) => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort(reason);
      child.emit('close');

      expect(await result).toBe(reason);
      expect(child.listenerCount('error')).toBe(0);
      expect(child.listenerCount('close')).toBe(0);
    });

    it('should preserve natural completion before a late abort', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter().probe('1.1.1.1', controller.signal);
      complete(null, 'time=11ms', '');
      controller.abort();
      child.emit('close', 0);

      expect((await result).latencyMs).toBe(11);
      expect(child.kill).not.toHaveBeenCalled();
    });

    it('should not kill a process that exited before the abort listener runs', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter().probe('1.1.1.1', controller.signal);
      Object.assign(child, { exitCode: 0 });
      controller.abort();
      complete(null, 'time=11ms', '');
      child.emit('close', 0);

      expect((await result).latencyMs).toBe(11);
      expect(child.kill).not.toHaveBeenCalled();
    });

    it.each(['before', 'after'])(
      'should preserve process errors occurring %s abort',
      async (order) => {
        runMock.mockImplementation(() => new Promise(() => {}));
        const controller = new AbortController();
        const failure = Object.assign(new Error('Spawn failed'), { code: 'ENOENT' });
        const result = new WindowsIcmpAdapter()
          .probe('1.1.1.1', controller.signal)
          .catch((error: unknown) => error);
        if (order === 'before') child.emit('error', failure);
        controller.abort();
        if (order === 'after') child.emit('error', failure);
        complete(null, '', '');
        child.emit('close');

        expect(await result).toBe(failure);
      },
    );

    it('should ignore only the exit error caused by cancellation', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      complete(
        Object.assign(new Error('Command killed'), { killed: true, signal: 'SIGTERM' as const }),
        '',
        '',
      );
      child.emit('close');

      expect(await result).toBe(controller.signal.reason);
    });

    it('should preserve a callback execution failure during cancellation', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const failure = Object.assign(new Error('Host lookup failed'), { code: 1 });
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      complete(failure, 'Host lookup failed', '');
      child.emit('close', 1);

      expect(await result).toBe(failure);
    });

    it('should report kill returning false and still wait for close', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      vi.mocked(child.kill).mockReturnValue(false);
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      child.emit('close');

      expect(await result).toEqual(new Error('Failed to terminate ping.exe.'));
    });

    it('should preserve a thrown kill error and clean up after close', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const failure = new Error('Access denied');
      vi.mocked(child.kill).mockImplementation(() => {
        throw failure;
      });
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      child.emit('close');

      expect(await result).toBe(failure);
      expect(child.listenerCount('error')).toBe(0);
    });

    it('should retry termination and release resources if close never arrives', async () => {
      vi.useFakeTimers();
      runMock.mockImplementation(() => new Promise(() => {}));
      const streams = { destroy: vi.fn() };
      Object.assign(child, { stdin: streams, stdout: streams, stderr: streams });
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      await vi.advanceTimersByTimeAsync(1000);

      expect(await result).toEqual(new Error('ping.exe did not close after termination.'));
      expect(streams.destroy).toHaveBeenCalledTimes(3);
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(child.listenerCount('close')).toBe(0);
      expect(child.listenerCount('error')).toBe(0);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      child.emit('close');
    });

    it('should clear the termination deadline when forced termination closes the process', async () => {
      vi.useFakeTimers();
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => error);
      controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      child.emit('close');

      expect(await result).toBe(controller.signal.reason);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should not start ping when already cancelled', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(new WindowsIcmpAdapter().probe('1.1.1.1', controller.signal)).rejects.toBe(
        controller.signal.reason,
      );
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it('should kill ping and wait for close on cancellation', async () => {
      runMock.mockImplementation(() => new Promise(() => {}));
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      let settled = false;
      const result = new WindowsIcmpAdapter()
        .probe('1.1.1.1', controller.signal)
        .catch((error: unknown) => {
          settled = true;
          return error;
        });

      controller.abort();
      expect(child.kill).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      expect(settled).toBe(false);
      child.emit('close', null, 'SIGTERM');

      expect(await result).toBe(controller.signal.reason);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it.each([false, true])(
      'should remove the abort listener after completion with failure %s',
      async (fails) => {
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        if (fails) {
          runMock.mockRejectedValue(new Error('Process execution failed'));
        } else {
          runMock.mockResolvedValue({ stdout: 'time=11ms', stderr: '' });
        }

        await new WindowsIcmpAdapter().probe('1.1.1.1', controller.signal).catch(() => undefined);
        controller.abort();

        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(child.kill).not.toHaveBeenCalled();
      },
    );

    it('should measure successful ICMP latency', async () => {
      runMock.mockResolvedValue({
        stdout: 'Reply from 1.1.1.1: bytes=32 time=11ms TTL=55',
        stderr: '',
      } as never);

      const adapter = new WindowsIcmpAdapter();
      const measurement = await adapter.probe('1.1.1.1');

      expect(measurement.host).toBe('1.1.1.1');
      expect(measurement.latencyMs).toBe(11);
      expect(measurement.timestamp).toBeInstanceOf(Date);
    });

    it('should execute ping.exe with the expected arguments', async () => {
      runMock.mockResolvedValue({
        stdout: 'Reply from 1.1.1.1: bytes=32 time=11ms TTL=55',
        stderr: '',
      } as never);

      const adapter = new WindowsIcmpAdapter(1500);

      await adapter.probe('1.1.1.1');

      expect(execFileMock).toHaveBeenCalledWith(
        'ping.exe',
        ['-n', '1', '-w', '1500', '1.1.1.1'],
        { windowsHide: true, timeout: 3500 },
        expect.any(Function),
      );
    });

    it('should handle latency below one millisecond', async () => {
      runMock.mockResolvedValue({
        stdout: 'Reply from 127.0.0.1: bytes=32 time<1ms TTL=128',
        stderr: '',
      } as never);

      const measurement = await new WindowsIcmpAdapter().probe('127.0.0.1');

      expect(measurement.latencyMs).toBe(0.5);
    });

    it('should return null latency for an ICMP timeout', async () => {
      const error = Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: 'Request timed out.',
      });

      runMock.mockRejectedValue(error);

      const measurement = await new WindowsIcmpAdapter().probe('192.0.2.1');

      expect(measurement.latencyMs).toBeNull();
      expect(measurement.isSuccessful()).toBe(false);
    });

    it('should reject unexpected ping failures', async () => {
      const error = Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: 'Ping request could not find host invalid-host.',
      });

      runMock.mockRejectedValue(error);

      await expect(new WindowsIcmpAdapter().probe('invalid-host')).rejects.toThrow(
        'Command failed',
      );
    });

    it('should reject an empty host', async () => {
      await expect(new WindowsIcmpAdapter().probe(' ')).rejects.toThrow('Host cannot be empty.');
    });

    it('should reject unsupported operating systems', async () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

      await expect(new WindowsIcmpAdapter().probe('1.1.1.1')).rejects.toThrow(
        'Windows ICMP adapter requires Windows.',
      );
    });

    it('should propagate process execution errors', async () => {
      runMock.mockRejectedValue(new Error('Process execution failed'));

      await expect(new WindowsIcmpAdapter().probe('1.1.1.1')).rejects.toThrow(
        'Process execution failed',
      );
    });
  });
});
