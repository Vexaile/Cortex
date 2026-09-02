/**
 * The one canonical list of serial baud rates, shared by the serial monitor's
 * dropdown and the Settings baud control so the two can never drift (a rate
 * present in only one would blank the other's select). Includes the ESP32
 * bootloader's 74880 and the high rates real firmware logs at.
 */
export const BAUD_RATES = [
  9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600
]
