import { arch, platform, release } from 'node:os';

/**
 * Provides the command-line interface for the application.
 */
export class CliAdapter {
  /**
   * Creates the CLI adapter.
   *
   * @param {string} name Application package name.
   * @param {string} version Application package version.
   */
  constructor(
    private readonly name: string,
    private readonly version: string,
  ) {}

  /**
   * Displays application and runtime environment information.
   *
   * @returns {void}
   */
  run(): void {
    console.log(`${this.name} v${this.version}`);
    console.log(`Operating system: ${platform()} ${release()}`);
    console.log(`Architecture: ${arch()}`);
    console.log(`Node.js: ${process.version}`);
  }
}
