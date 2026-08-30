// hello.rs - single-file Rust runs in Cortex (rustc) with the Run button (F5).
// Systems-level work sits alongside your C++ firmware and Python tests.

fn moving_average(samples: &[f64], window: usize) -> Vec<f64> {
    samples
        .windows(window)
        .map(|w| w.iter().sum::<f64>() / window as f64)
        .collect()
}

fn main() {
    let readings = [22.1, 22.8, 23.4, 24.0, 25.5, 26.1, 25.9, 24.7];
    let smoothed = moving_average(&readings, 3);

    println!("Cortex running Rust");
    for (i, v) in smoothed.iter().enumerate() {
        println!("temp:{:.2} sample:{}", v, i);
    }
}
