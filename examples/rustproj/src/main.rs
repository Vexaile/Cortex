mod filter;

fn main() {
    let mut f = filter::Moving::new();
    for mv in [3300u16, 3280, 3260, 3240] {
        println!("smoothed = {}", f.push(mv));
    }
}
