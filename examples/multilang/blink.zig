// Zig on an MCU: comptime pin config, no hidden allocations.
const std = @import("std");

const Pin = struct {
    number: u8,
    high: bool = false,

    pub fn toggle(self: *Pin) void {
        self.high = !self.high;
    }
};

pub fn main() !void {
    var led = Pin{ .number = 13 };
    var i: u32 = 0;
    while (i < 5) : (i += 1) {
        led.toggle();
        std.debug.print("pin {d} = {}\n", .{ led.number, led.high });
    }
}
