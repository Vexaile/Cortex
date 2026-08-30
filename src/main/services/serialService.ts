import type { BrowserWindow } from 'electron'
import type { SerialPortDescriptor, SerialOpenOptions } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'

// serialport is a native optional dependency. Load it lazily so a failed
// native build never prevents the IDE from starting.
type SerialPortModule = typeof import('serialport')
let mod: SerialPortModule | null | undefined

async function load(): Promise<SerialPortModule | null> {
  if (mod !== undefined) return mod
  try {
    mod = (await import('serialport')) as SerialPortModule
  } catch {
    mod = null
  }
  return mod
}

export async function isAvailable(): Promise<boolean> {
  return (await load()) !== null
}

export async function listPorts(): Promise<SerialPortDescriptor[]> {
  const m = await load()
  if (!m) return []
  const ports = await m.SerialPort.list()
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber,
    vendorId: p.vendorId,
    productId: p.productId,
    friendlyName: (p as { friendlyName?: string }).friendlyName
  }))
}

let port: import('serialport').SerialPort | null = null

function status(win: BrowserWindow, open: boolean, path: string, message?: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IPC.SERIAL_STATUS, { open, path, message })
  }
}

export async function openPort(win: BrowserWindow, opts: SerialOpenOptions): Promise<boolean> {
  const m = await load()
  if (!m) {
    status(win, false, opts.path, 'serialport module unavailable')
    return false
  }
  await closePort()
  return new Promise((resolve) => {
    port = new m.SerialPort(
      {
        path: opts.path,
        baudRate: opts.baudRate,
        dataBits: opts.dataBits ?? 8,
        stopBits: opts.stopBits ?? 1,
        parity: opts.parity ?? 'none'
      },
      (err) => {
        if (err) {
          status(win, false, opts.path, err.message)
          port = null
          resolve(false)
        } else {
          status(win, true, opts.path)
          resolve(true)
        }
      }
    )
    port.on('data', (chunk: Buffer) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SERIAL_DATA, { data: chunk.toString('utf8') })
      }
    })
    // A clean close is NOT an error. Sending a message here made every normal
    // disconnect (and every upload, which closes the port first) paint a red
    // error box. Real failures still arrive via 'error' and the open callback.
    port.on('close', () => status(win, false, opts.path))
    port.on('error', (e: Error) => status(win, false, opts.path, e.message))
  })
}

export async function writePort(data: string): Promise<void> {
  if (port?.isOpen) port.write(data)
}

export async function closePort(): Promise<void> {
  if (port?.isOpen) {
    await new Promise<void>((resolve) => port!.close(() => resolve()))
  }
  port = null
}
