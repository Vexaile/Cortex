// Firmware/sense.cpp - C++23. Emits telemetry the Serial Plotter understands.
#include <iostream>
#include <array>
#include <numeric>
#include <ranges>
#include <cstdint>

namespace {
// A tiny moving-average filter - the kind of thing you'd run on an MCU.
template <std::size_t N>
class MovingAverage {
public:
    float push(float sample) {
        buf_[idx_] = sample;
        idx_ = (idx_ + 1) % N;
        return std::accumulate(buf_.begin(), buf_.end(), 0.0f) / static_cast<float>(N);
    }
private:
    std::array<float, N> buf_{};
    std::size_t idx_{0};
};
}  // namespace

int main() {
    MovingAverage<4> tempFilter;
    // Simulated ADC readings.
    constexpr std::array raw{22.1f, 22.8f, 23.4f, 24.0f, 25.5f, 26.1f, 25.9f, 24.7f};

    for (auto&& [i, sample] : std::views::enumerate(raw)) {   // C++23 views::enumerate
        float smoothed = tempFilter.push(sample);
        std::uint16_t voltage_mV = static_cast<std::uint16_t>(3300 + sample * 5);
        // "key:value" lines auto-plot in the Cortex Serial Monitor.
        std::cout << "temp:" << smoothed
                  << " voltage:" << voltage_mV
                  << " rpm:" << (1200 + i * 37) << '\n';
    }
    std::cout << "firmware finished (C++ " << __cplusplus << ")\n";
}
