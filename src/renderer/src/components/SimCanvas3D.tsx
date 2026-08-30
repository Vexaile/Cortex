import { useRef, useState } from 'react'
import { Plane, Vector3 } from 'three'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Grid, ContactShadows, Html, QuadraticBezierLine } from '@react-three/drei'
import { useStore, type SimPart, INPUT_PARTS, PART_PINS } from '../store/useStore'
import { ADC_MAX, PWM_MAX } from '@shared/simProtocol'
import {
  BOARDS,
  type BoardDef,
  type Feature,
  type Pin3D,
  DESIGN_CENTER,
  toWorld,
  pinTopY,
  PART_TOP_Y
} from './sim3d/board3d'

// The workbench plane (y = 0). A drag reads the pointer ray's intersection with
// it, so the part follows the cursor even when it leaves the part's own mesh.
const DRAG_PLANE = new Plane(new Vector3(0, 1, 0), 0)
const DRAG_HIT = new Vector3()

/**
 * The 3D simulator view. A drop-in sibling of the 2D SimCanvas: it reads and
 * mutates the SAME store (simParts, simWiring, the pin-state maps), so wiring,
 * running, add/delete and the live pin values stay in sync between the two.
 * Only the rendering differs.
 *
 * The board (Uno / ESP32 / Pi) comes from the board registry in board3d.ts;
 * wires route to whichever board pin matches the part's stored pin number.
 * Lazy-loaded from SimulatorView so three.js never enters the editor's bundle.
 */

interface Reading {
  value: number
  pwm: boolean
}

const WIRE_COLOR: Record<string, string> = { r: '#E05561', g: '#6FB65A', b: '#5B9DF0', sig: '#E8952B' }

function makeRead(
  simPinStates: Record<number, number>,
  simPinPwm: Record<number, boolean>,
  simInputs: Record<number, number>
) {
  return (part: SimPart, name: string): Reading => {
    const bp = part.pins[name]
    if (bp == null) return { value: 0, pwm: false }
    if (INPUT_PARTS.includes(part.type)) return { value: simInputs[bp] ?? 0, pwm: false }
    return { value: simPinStates[bp] ?? 0, pwm: simPinPwm[bp] ?? false }
  }
}

function brightness(r: Reading): number {
  return r.pwm ? r.value / PWM_MAX : r.value > 0 ? 1 : 0
}

/**
 * Local (part-space) position of a named pin's connector. Single-pin parts wire
 * from the part's top; multi-pin parts (RGB, 7-seg) expose a row of connector
 * nubs in front, so each pin can be wired independently. Shared so the nub the
 * user clicks and the wire that leaves it are always the same point.
 */
function partPinLocal(type: SimPart['type'], name: string): [number, number, number] {
  const names = PART_PINS[type]
  if (names.length <= 1) {
    // The button's body is a press target, so its wire connector is a separate
    // nub in front; other single-pin parts wire from the body top.
    return type === 'button' ? [0, 4, 14] : [0, PART_TOP_Y, 0]
  }
  const i = names.indexOf(name)
  const spread = (names.length - 1) * 5
  return [-spread / 2 + i * 5, 4, 12]
}

function FeatureMesh({ f }: { f: Feature }): JSX.Element {
  return (
    <mesh position={f.pos} castShadow>
      {f.kind === 'box' ? (
        <boxGeometry args={f.size} />
      ) : (
        <cylinderGeometry args={[f.size[0], f.size[0], f.size[1], f.size[2] || 16]} />
      )}
      <meshStandardMaterial color={f.color} metalness={f.metal ?? 0.2} roughness={f.rough ?? 0.6} />
    </mesh>
  )
}

function Board({ def, led }: { def: BoardDef; led: number }): JSX.Element {
  const { w, d, h } = def.size
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={def.pcb} roughness={0.5} metalness={0.25} />
      </mesh>
      {def.features.map((f, i) => (
        <FeatureMesh key={i} f={f} />
      ))}
      {def.ledPos && (
        <mesh position={def.ledPos}>
          <boxGeometry args={[7, 3, 7]} />
          <meshStandardMaterial
            color="#E8952B"
            emissive="#E8952B"
            emissiveIntensity={led > 0 ? 2.4 : 0.05}
            toneMapped={false}
          />
        </mesh>
      )}
      <Html position={def.labelPos} center style={{ pointerEvents: 'none' }}>
        <span className="select-none whitespace-nowrap text-[9px] font-semibold tracking-widest text-white/40">
          {def.name}
        </span>
      </Html>
    </group>
  )
}

const PIN_BASE: Record<string, string> = { power: '#E0555f', gnd: '#39424f', analog: '#c9a24a', gpio: '#c9a24a' }

function Socket({
  p,
  topY,
  armed,
  onPick
}: {
  p: Pin3D
  topY: number
  armed: boolean
  onPick: (pin: number) => void
}): JSX.Element {
  const [hover, setHover] = useState(false)
  const wireable = p.pin >= 0
  const lit = wireable && (armed || hover)
  const y = topY - 5
  return (
    <group position={[p.x, 0, p.z]}>
      {wireable && (
        <mesh
          position={[0, y + 2, 0]}
          onClick={(e) => {
            e.stopPropagation()
            onPick(p.pin)
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHover(true)
          }}
          onPointerOut={() => setHover(false)}
        >
          <cylinderGeometry args={[4, 4, 10, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <mesh position={[0, y + 1, 0]}>
        <cylinderGeometry args={[1.5, 1.5, 8, 12]} />
        <meshStandardMaterial
          color={lit ? '#ffd479' : (PIN_BASE[p.kind] ?? '#c9a24a')}
          emissive={lit ? '#E8952B' : '#000000'}
          emissiveIntensity={lit ? 1.6 : 0}
          metalness={0.9}
          roughness={0.3}
        />
      </mesh>
      {(armed || hover) && (
        <Html position={[0, topY + 6, 0]} center style={{ pointerEvents: 'none' }}>
          <span className="mono select-none rounded bg-ide-bar/90 px-1 text-[8px] text-ide-text">{p.label}</span>
        </Html>
      )}
    </group>
  )
}

function Part3D({
  part,
  pos,
  read,
  selected,
  draggable,
  onSelect,
  onArmPin,
  onDrag,
  onDragState,
  onInput
}: {
  part: SimPart
  pos: [number, number]
  read: (part: SimPart, name: string) => Reading
  selected: boolean
  draggable: boolean
  onSelect: () => void
  onArmPin: (name: string) => void
  onDrag: (worldX: number, worldZ: number) => void
  onDragState: (active: boolean) => void
  onInput: (v: number) => void
}): JSX.Element {
  const [wx, wz] = pos
  const sig = read(part, 'sig')
  const b = brightness(sig)
  const color = part.color || '#6FB65A'
  const names = PART_PINS[part.type]
  const single = names.length === 1
  // The button presses, so it wires from a nub like a multi-pin part; its body
  // must not arm a wire on every tap.
  const bodyArms = single && part.type !== 'button'
  const showNubs = !single || part.type === 'button'
  const dragging = useRef(false)
  const moved = useRef(false)

  // A body click selects; only a plain single-pin part also arms its wire. A
  // click that was really a drag arms nothing.
  const click = (e: ThreeEvent<MouseEvent>): void => {
    e.stopPropagation()
    if (moved.current) {
      moved.current = false
      return
    }
    onSelect()
    if (bodyArms) onArmPin(names[0])
  }

  // Drag on the workbench plane, feeding design coords back through movePart so
  // the 2D canvas stays in sync. Only where the mapping is 1:1 (the Uno).
  const endDrag = (): void => {
    if (!dragging.current) return
    dragging.current = false
    // Re-enable the camera. Do this on lost-capture too, or a dropped pointer
    // (alt-tab mid-drag) would freeze orbit forever.
    onDragState(false)
  }
  const drag = draggable
    ? {
        onPointerDown: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          ;(e.target as Element).setPointerCapture(e.pointerId)
          dragging.current = true
          moved.current = false
          onDragState(true) // suspend OrbitControls so the drag does not also orbit
        },
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
          if (!dragging.current) return
          e.stopPropagation()
          if (e.ray.intersectPlane(DRAG_PLANE, DRAG_HIT)) {
            moved.current = true
            onDrag(DRAG_HIT.x, DRAG_HIT.z)
          }
        },
        onPointerUp: (e: ThreeEvent<PointerEvent>) => {
          ;(e.target as Element).releasePointerCapture(e.pointerId)
          endDrag()
        },
        onLostPointerCapture: () => endDrag()
      }
    : {}

  let body: JSX.Element
  switch (part.type) {
    case 'led':
      body = (
        <mesh position={[0, 9, 0]} onClick={click} castShadow>
          <sphereGeometry args={[7, 20, 20]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.15 + b * 2.4}
            roughness={0.25}
            toneMapped={false}
          />
        </mesh>
      )
      break
    case 'rgb': {
      const chan = (n: string): number => {
        const r = read(part, n)
        return r.pwm ? r.value : r.value > 0 ? 255 : 0
      }
      const rgb = `rgb(${chan('r')},${chan('g')},${chan('b')})`
      const bright = Math.max(chan('r'), chan('g'), chan('b')) / PWM_MAX
      body = (
        <mesh position={[0, 9, 0]} onClick={click} castShadow>
          <sphereGeometry args={[8, 20, 20]} />
          <meshStandardMaterial color={rgb} emissive={rgb} emissiveIntensity={0.1 + bright * 2.4} toneMapped={false} />
        </mesh>
      )
      break
    }
    case 'button':
      body = (
        <group
          onClick={click}
          onPointerDown={(e) => {
            e.stopPropagation()
            const pullup = part.pins.sig != null && useStore.getState().simPinModes[part.pins.sig] === 2
            onInput(pullup ? 0 : ADC_MAX)
          }}
          onPointerUp={(e) => {
            e.stopPropagation()
            const pullup = part.pins.sig != null && useStore.getState().simPinModes[part.pins.sig] === 2
            onInput(pullup ? ADC_MAX : 0)
          }}
        >
          <mesh position={[0, 4, 0]} castShadow>
            <boxGeometry args={[14, 8, 14]} />
            <meshStandardMaterial color="#171d28" roughness={0.6} />
          </mesh>
          <mesh position={[0, 9, 0]} castShadow>
            <cylinderGeometry args={[5, 5, 3, 20]} />
            <meshStandardMaterial color="#232b38" metalness={0.4} roughness={0.5} />
          </mesh>
        </group>
      )
      break
    case 'buzzer':
      body = (
        <mesh position={[0, 7, 0]} onClick={click} castShadow>
          <cylinderGeometry args={[9, 9, 14, 24]} />
          <meshStandardMaterial color="#11161f" roughness={0.5} />
        </mesh>
      )
      break
    case 'potentiometer':
    case 'ldr':
    case 'thermistor': {
      const t = Math.min(ADC_MAX, Math.max(0, sig.value)) / ADC_MAX
      body = (
        <group onClick={click}>
          <mesh position={[0, 4, 0]} castShadow>
            <cylinderGeometry args={[11, 11, 8, 24]} />
            <meshStandardMaterial color="#171d28" roughness={0.6} />
          </mesh>
          <mesh position={[0, 9, 0]} rotation={[0, (-135 + t * 270) * (Math.PI / 180), 0]}>
            <boxGeometry args={[2, 2, 11]} />
            <meshStandardMaterial color="#E8952B" emissive="#E8952B" emissiveIntensity={0.4} toneMapped={false} />
          </mesh>
        </group>
      )
      break
    }
    case 'servo': {
      const angle = sig.pwm ? (sig.value / PWM_MAX) * 180 - 90 : 0
      body = (
        <group onClick={click}>
          <mesh position={[0, 6, 0]} castShadow>
            <boxGeometry args={[26, 12, 16]} />
            <meshStandardMaterial color="#2E6FE0" roughness={0.5} />
          </mesh>
          <mesh position={[0, 13, 0]} rotation={[0, angle * (Math.PI / 180), 0]}>
            <boxGeometry args={[22, 2, 3]} />
            <meshStandardMaterial color="#E6EBF4" />
          </mesh>
        </group>
      )
      break
    }
    default:
      body = (
        <mesh position={[0, 6, 0]} onClick={click} castShadow>
          <cylinderGeometry args={[12, 12, 12, 6]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={b * 1.6} toneMapped={false} />
        </mesh>
      )
  }

  return (
    <group position={[wx, 0, wz]} {...drag}>
      {body}
      {/* Connector nubs: click one to wire that pin. Multi-pin parts show one
          per pin; the button shows one so its body stays a press target. */}
      {showNubs &&
        names.map((name) => {
          const [lx, ly, lz] = partPinLocal(part.type, name)
          const bound = part.pins[name] != null
          const c = bound ? '#6FB65A' : (WIRE_COLOR[name] ?? '#E8952B')
          return (
            <mesh
              key={name}
              position={[lx, ly, lz]}
              onClick={(e) => {
                e.stopPropagation()
                onSelect()
                onArmPin(name)
              }}
            >
              <sphereGeometry args={[2.6, 12, 12]} />
              <meshStandardMaterial color={c} emissive={c} emissiveIntensity={bound ? 0.6 : 0.25} toneMapped={false} />
            </mesh>
          )
        })}
      {selected && (
        <mesh position={[0, 0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[15, 18, 40]} />
          <meshBasicMaterial color="#2E6FE0" transparent opacity={0.9} />
        </mesh>
      )}
      <Html position={[0, 20, 0]} center style={{ pointerEvents: 'none' }}>
        <span className="mono select-none whitespace-nowrap text-[8px] uppercase tracking-wide text-ide-faint">
          {part.type}
        </span>
      </Html>
    </group>
  )
}

function Wires({
  def,
  parts,
  positions,
  read
}: {
  def: BoardDef
  parts: SimPart[]
  positions: [number, number][]
  read: (part: SimPart, name: string) => Reading
}): JSX.Element {
  const topY = pinTopY(def)
  const lines: JSX.Element[] = []
  parts.forEach((part, idx) => {
    const [wx, wz] = positions[idx]
    for (const name of PART_PINS[part.type]) {
      const bp = part.pins[name]
      if (bp == null) continue
      const dest = def.pins.find((p) => p.pin === bp)
      // A wire to a pin the current board does not expose is simply not drawn.
      if (!dest) continue
      const [lx, ly, lz] = partPinLocal(part.type, name)
      const start: [number, number, number] = [wx + lx, ly, wz + lz]
      const end: [number, number, number] = [dest.x, topY, dest.z]
      const mid: [number, number, number] = [(start[0] + end[0]) / 2, Math.max(ly, topY) + 46, (start[2] + end[2]) / 2]
      const on = brightness(read(part, name)) > 0.05
      const color = WIRE_COLOR[name] ?? part.color ?? '#E8952B'
      lines.push(
        <QuadraticBezierLine
          key={`${part.id}-${name}`}
          start={start}
          end={end}
          mid={mid}
          color={color}
          lineWidth={on ? 3 : 2}
          transparent
          opacity={on ? 1 : 0.7}
        />
      )
    }
  })
  return <>{lines}</>
}

export default function SimCanvas3D(): JSX.Element {
  const {
    sim3dBoard,
    simParts,
    simWiring,
    simPinStates,
    simPinPwm,
    simInputs,
    beginWire,
    attachWire,
    cancelWire,
    movePart,
    setSimInput
  } = useStore()
  const [selected, setSelected] = useState<string | null>(null)
  // While a part is dragged, OrbitControls is suspended so the same gesture does
  // not also orbit the camera.
  const [dragActive, setDragActive] = useState(false)
  // Screen position of the last pointer-down on the backdrop, so a click that
  // was really an orbit (moved far) does not cancel an armed wire.
  const backdropDown = useRef<[number, number] | null>(null)
  const def = BOARDS[sim3dBoard]
  const read = makeRead(simPinStates, simPinPwm, simInputs)
  const topY = pinTopY(def)

  // Part placement. The Uno keeps its 1:1 mapping from the 2D canvas, so moving
  // a part in 2D moves it here. Other boards have no 2D layout, so parts sit in
  // a tidy row just in front of the board rather than floating at Uno offsets.
  const partXZ = (part: SimPart, i: number): [number, number] => {
    if (def.id === 'uno') return toWorld(part.x, part.y)
    const n = simParts.length
    const spread = Math.min(def.size.w * 0.95, 440)
    const x = n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0
    return [x, def.size.d / 2 + 55]
  }
  const positions = simParts.map(partXZ)

  return (
    <div className="h-full w-full">
      {/* Remount on board switch so the camera reframes for the new footprint. */}
      <Canvas key={def.id} shadows camera={{ position: def.camera, fov: 38 }} dpr={[1, 2]}>
        <color attach="background" args={['#0C1017']} />
        <ambientLight intensity={0.9} />
        <hemisphereLight args={['#dce6ff', '#0a0f16', 0.55]} />
        <directionalLight position={[140, 340, 200]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} />
        <directionalLight position={[-200, 160, -160]} intensity={0.55} color="#3b7fe0" />

        <Grid
          args={[2400, 2400]}
          position={[0, 0.02, 0]}
          cellSize={20}
          cellThickness={0.6}
          sectionSize={100}
          sectionThickness={1}
          cellColor="#1B2230"
          sectionColor="#26303f"
          fadeDistance={1100}
          fadeStrength={1}
          infiniteGrid
        />
        <ContactShadows position={[0, 0.05, 0]} opacity={0.5} scale={1000} blur={2.6} far={80} color="#000000" />

        <mesh
          position={[0, -0.5, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerDown={(e) => (backdropDown.current = [e.clientX, e.clientY])}
          onClick={(e) => {
            // Only a genuine click on empty space cancels: an orbit is a
            // down+drag+up on the backdrop and would otherwise discard an
            // armed wire the moment the user looks for the target pin.
            const d = backdropDown.current
            if (d && Math.abs(e.clientX - d[0]) + Math.abs(e.clientY - d[1]) > 5) return
            cancelWire()
            setSelected(null)
          }}
        >
          <planeGeometry args={[5000, 5000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>

        <Board def={def} led={simPinStates[def.ledPin ?? -1] ?? 0} />

        {def.pins.map((p) => (
          <Socket
            key={`${p.label}-${p.x}-${p.z}`}
            p={p}
            topY={topY}
            armed={simWiring != null}
            onPick={(pin) => {
              if (simWiring) attachWire(pin)
            }}
          />
        ))}

        <Wires def={def} parts={simParts} positions={positions} read={read} />

        {simParts.map((part, i) => (
          <Part3D
            key={part.id}
            part={part}
            pos={positions[i]}
            read={read}
            selected={selected === part.id}
            draggable={def.id === 'uno'}
            onSelect={() => setSelected(part.id)}
            onArmPin={(name) => beginWire(part.id, name)}
            onDrag={(x, z) => movePart(part.id, x + DESIGN_CENTER.x, z + DESIGN_CENTER.y)}
            onDragState={setDragActive}
            onInput={(v) => part.pins.sig != null && setSimInput(part.pins.sig, v)}
          />
        ))}

        <OrbitControls
          makeDefault
          enabled={!dragActive}
          enableDamping
          dampingFactor={0.12}
          minDistance={140}
          maxDistance={1100}
          maxPolarAngle={Math.PI / 2.15}
          target={[0, 0, 0]}
        />
      </Canvas>
    </div>
  )
}
