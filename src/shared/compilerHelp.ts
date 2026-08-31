/**
 * Guidance for installing a host C++ compiler, shown when the simulator (which
 * compiles the sketch on this machine) cannot find g++ or clang++. Pure and
 * dependency-free so it is unit-tested and reused by the renderer's blocked
 * state. The renderer picks the OS from navigator.userAgent.
 */

export type OS = 'windows' | 'mac' | 'linux'

export function detectOS(userAgent: string): OS {
  const s = userAgent.toLowerCase()
  // Test mac/darwin before windows: "darwin" contains the substring "win", so a
  // Darwin user agent must be matched here or it falls through to Windows. No
  // real Windows UA contains "mac" or "darwin", so this order is safe both ways.
  if (s.includes('mac') || s.includes('darwin')) return 'mac'
  if (s.includes('win')) return 'windows'
  return 'linux'
}

export interface CompilerHelp {
  os: OS
  /** The single command to copy and run. */
  command: string
  /** A short follow-up line (a second step, or an alternative). */
  note: string
  /** A documentation link for the recommended toolchain. */
  docUrl: string
  docLabel: string
}

export function compilerInstallHelp(os: OS): CompilerHelp {
  switch (os) {
    case 'windows':
      return {
        os,
        command: 'winget install MSYS2.MSYS2',
        note: 'Then in the MSYS2 terminal run: pacman -S mingw-w64-ucrt-x86_64-gcc, and add its bin folder to PATH. Or install LLVM and put clang++ on PATH.',
        docUrl: 'https://www.msys2.org/',
        docLabel: 'MSYS2 setup guide'
      }
    case 'mac':
      return {
        os,
        command: 'xcode-select --install',
        note: 'Installs the Apple command line tools, which include clang++.',
        docUrl: 'https://developer.apple.com/xcode/resources/',
        docLabel: 'Apple developer tools'
      }
    default:
      return {
        os: 'linux',
        command: 'sudo apt install build-essential',
        note: 'On Fedora: sudo dnf install gcc-c++. On Arch: sudo pacman -S gcc.',
        docUrl: 'https://gcc.gnu.org/install/',
        docLabel: 'GCC install guide'
      }
  }
}
