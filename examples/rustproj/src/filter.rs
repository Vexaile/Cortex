pub struct Moving { buf: [u16; 4], idx: usize }

impl Moving {
    pub fn new() -> Self { Moving { buf: [0; 4], idx: 0 } }
    pub fn push(&mut self, v: u16) -> u32 {
        self.buf[self.idx] = v;
        self.idx = (self.idx + 1) % self.buf.len();
        self.buf.iter().map(|&x| x as u32).sum::<u32>() / self.buf.len() as u32
    }
}
