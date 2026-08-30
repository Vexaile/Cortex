// seven_seg.ino - counts 0-9 on a 7-segment display.
// In the Simulator: add a 7-seg, wire a->2 b->3 c->4 d->5 e->6 f->7 g->8, Run.

const int seg[7] = {2, 3, 4, 5, 6, 7, 8}; // a b c d e f g

// Bit i (0=a .. 6=g) is 1 when that segment is lit for the digit.
const byte digits[10] = {
  0b0111111, // 0
  0b0000110, // 1
  0b1011011, // 2
  0b1001111, // 3
  0b1100110, // 4
  0b1101101, // 5
  0b1111101, // 6
  0b0000111, // 7
  0b1111111, // 8
  0b1101111  // 9
};

void setup() {
  for (int i = 0; i < 7; i++) pinMode(seg[i], OUTPUT);
  Serial.begin(115200);
}

void loop() {
  for (int d = 0; d < 10; d++) {
    for (int i = 0; i < 7; i++) digitalWrite(seg[i], (digits[d] >> i) & 1);
    Serial.print("digit ");
    Serial.println(d);
    delay(700);
  }
}
