// Cortex: a C++23 quick demo.
// Press Run (F5) with the standard set to c++23 in the toolbar. Set it to
// c++11 (what the Arduino IDE gives you) and every feature below fails.
//
// This uses C++23 features that will NOT compile under Arduino's C++11:
//   - std::to_underlying  (<utility>)
//   - if consteval
//   - ranges pipelines
#include <iostream>
#include <utility>
#include <vector>
#include <ranges>

enum class Sensor : int { Temp = 1, Voltage = 2, Rpm = 3 };

constexpr int scale(int x) {
    if consteval { return x * 2; }   // C++23
    return x * 2;
}

int main() {
    std::cout << "Cortex is running C++ standard " << __cplusplus << '\n';
    std::cout << "Sensor::Rpm id = " << std::to_underlying(Sensor::Rpm) << '\n';

    std::vector<int> samples{10, 12, 9, 15, 22, 18, 25, 30};
    auto boosted = samples | std::views::transform(scale)
                           | std::views::filter([](int v) { return v > 25; });

    std::cout << "boosted samples > 25:";
    for (int v : boosted) std::cout << ' ' << v;
    std::cout << '\n';

    for (std::size_t i = 0; i < samples.size(); ++i)
        std::cout << "temp:" << samples[i] << " voltage:" << (3300 + samples[i]) << '\n';

    std::cout << "done.\n";
}
