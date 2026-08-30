"""Tests/sensor_test.py - the Python side of an embedded project.

In a real project this would talk to the board over serial, validate ranges,
and plot captured data. Here it just demonstrates that Python runs alongside
the C++ firmware in the same Cortex workspace. Press Run (F5)."""

from statistics import mean, pstdev

# Pretend these came back from the device over serial.
readings = [22.1, 22.8, 23.4, 24.0, 25.5, 26.1, 25.9, 24.7]

def check(name: str, value: float, lo: float, hi: float) -> bool:
    ok = lo <= value <= hi
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {value:.2f} (expected {lo}..{hi})")
    return ok

print("Running sensor tests...")
results = [
    check("mean temperature", mean(readings), 20.0, 30.0),
    check("temperature noise (stdev)", pstdev(readings), 0.0, 2.0),
    check("max reading", max(readings), 0.0, 40.0),
]

passed = sum(results)
print(f"\n{passed}/{len(results)} checks passed.")
raise SystemExit(0 if passed == len(results) else 1)
