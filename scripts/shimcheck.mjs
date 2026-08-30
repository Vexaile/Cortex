/**
 * Compiles one sketch against the shim and prints its output. The vitest suite
 * spawns a fresh g++ per case, which is ~60s each; this is the fast loop for
 * iterating on the shim itself. Usage: node scripts/shimcheck.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Read the shim out of the TS source without a build step: it is one raw
// template literal, and the only interpolations are the shared scale constants.
const src = readFileSync('src/main/services/arduinoShim.ts', 'utf8')
const proto = readFileSync('src/shared/simProtocol.ts', 'utf8')
const num = (name) => Number(proto.match(new RegExp(`export const ${name} = (\\d+)`))[1])
const consts = { ADC_MAX: num('ADC_MAX'), LOGIC_THRESHOLD: num('LOGIC_THRESHOLD'), PWM_MAX: num('PWM_MAX') }

const raw = src.slice(src.indexOf('String.raw`') + 'String.raw`'.length, src.lastIndexOf('`'))
const shim = raw.replace(/\$\{(\w+)\}/g, (_, k) => {
  if (!(k in consts)) throw new Error(`unknown interpolation \${${k}}`)
  return String(consts[k])
})

const SKETCH = process.env.SHIM_SKETCH ? process.env.SHIM_SKETCH : `
void setup() {
  Serial.begin(115200);
  Serial.println(3.14159);
  Serial.println(1.0);
  Serial.println(1000000.0);
  float v = 3.14159;
  Serial.println(v, 3);
  Serial.println(millis(), DEC);
  Serial.println(42UL, HEX);
  byte b = 200; Serial.println(b);
  byte nl = 10; Serial.print("a"); Serial.print(nl); Serial.println("z");
  Serial.println(255, HEX);
  Serial.println(255, BIN);
  Serial.println('A');
  pinMode(13, OUTPUT); digitalWrite(13, HIGH);
  Serial.print("d13="); Serial.println(digitalRead(13));
  Serial.print("a13="); Serial.println(analogRead(13));
  pinMode(4, INPUT_PULLUP);
  Serial.print("pullup="); Serial.println(digitalRead(4));
  analogWrite(9, 300);
  analogWrite(10, -5);
  Serial.print("A0="); Serial.println(A0);
  Serial.print("Ready...");
}
`

const dir = mkdtempSync(join(tmpdir(), 'shimcheck-'))
writeFileSync(join(dir, 'Arduino.h'), shim)
writeFileSync(join(dir, 's.cpp'), `#include "Arduino.h"\n${SKETCH}\nint main(){ setup(); return 0; }\n`)
const exe = join(dir, 'a.exe')
try {
  execFileSync('g++', ['-std=c++23', '-I', dir, join(dir, 's.cpp'), '-o', exe], { stdio: 'pipe' })
} catch (e) {
  console.error('COMPILE FAILED:\n' + e.stderr?.toString().split('\n').slice(0, 25).join('\n'))
  process.exit(1)
}
const runs = Number(process.env.SHIM_RUNS || 1)
for (let i = 0; i < runs; i++) {
  const r = spawnSync(exe, { encoding: 'utf8' })
  if (runs > 1) console.log(`run ${i}: status=${r.status} signal=${r.signal} out=${JSON.stringify(r.stdout)}`)
  else console.log(r.stdout)
}
