import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { WindowsIcmpAdapter } from '../../../src/infrastructure/network/WindowsIcmpAdapter.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: () => execFile,
}));

const execFileMock = vi.mocked(execFile);

describe('WindowsIcmpAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
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
    it('should measure successful ICMP latency', async () => {
      execFileMock.mockResolvedValue({
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
      execFileMock.mockResolvedValue({
        stdout: 'Reply from 1.1.1.1: bytes=32 time=11ms TTL=55',
        stderr: '',
      } as never);

      const adapter = new WindowsIcmpAdapter(1500);

      await adapter.probe('1.1.1.1');

      expect(execFileMock).toHaveBeenCalledWith('ping.exe', ['-n', '1', '-w', '1500', '1.1.1.1'], {
        windowsHide: true,
        timeout: 3500,
      });
    });

    it('should handle latency below one millisecond', async () => {
      execFileMock.mockResolvedValue({
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

      execFileMock.mockRejectedValue(error);

      const measurement = await new WindowsIcmpAdapter().probe('192.0.2.1');

      expect(measurement.latencyMs).toBeNull();
      expect(measurement.isSuccessful()).toBe(false);
    });

    it('should reject unexpected ping failures', async () => {
      const error = Object.assign(new Error('Command failed'), {
        code: 1,
        stdout: 'Ping request could not find host invalid-host.',
      });

      execFileMock.mockRejectedValue(error);

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
      execFileMock.mockRejectedValue(new Error('Process execution failed'));

      await expect(new WindowsIcmpAdapter().probe('1.1.1.1')).rejects.toThrow(
        'Process execution failed',
      );
    });
  });
});
