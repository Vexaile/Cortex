// rgb_fade.ino - fades an RGB LED through the color wheel.
// In the Simulator: add an RGB LED, wire r->9, g->10, b->11, then press Run.

const int R = 9, G = 10, B = 11;

void setup() {
  pinMode(R, OUTPUT);
  pinMode(G, OUTPUT);
  pinMode(B, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  for (int i = 0; i < 256; i++) {
    analogWrite(R, i);
    analogWrite(G, 255 - i);
    analogWrite(B, (i * 2) % 256);
    delay(8);
  }
}
