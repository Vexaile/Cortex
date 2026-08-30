// Rust on the host: the tests and tooling around firmware.
#[derive(Debug)]
struct Sample { pin: u8, mv: u16 }

fn main() {
    let readings: Vec<Sample> = (0..5)
        .map(|i| Sample { pin: 13, mv: 3300 - i * 100 })
        .collect();
    for s in &readings {
        println!("pin {} -> {} mV", s.pin, s.mv);
    }
}
