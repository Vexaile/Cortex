# Example: Robot project (multi-language)

This mirrors how embedded work actually spans languages - the thing Cortex is built for.

```
robot/
  Firmware/   sense.cpp     C++23 - the low-level embedded logic
  Tests/      sensor_test.py Python - hardware tests / data analysis
  Dashboard/  telemetry.ts  TypeScript - the telemetry UI layer
```

Open the `examples/robot` folder as a workspace, then:
- Open `Firmware/sense.cpp`, set the standard to **c++23** in the toolbar, and press **Run (F5)**.
- Open `Tests/sensor_test.py` and press **Run** - it executes with your configured Python.
- The firmware prints `key:value` telemetry lines; connect a board and the **Serial Monitor's
  live plotter** will graph the same shape of data automatically.
