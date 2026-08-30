// esp32_fade.ino - ESP32 LEDC PWM fade.
// This is ESP32 code, not Uno code: it uses the LEDC peripheral (ledcSetup /
// ledcAttachPin / ledcWrite) instead of analogWrite.
//
// In the 3D view pick the ESP32 board, add an LED, wire it to GPIO2, then Run.
// The LED breathes as the duty cycle ramps up and back down.

const int LED  = 2;      // GPIO2
const int CH   = 0;      // LEDC channel
const int FREQ = 5000;   // Hz
const int RES  = 8;      // 8-bit duty: 0..255

void setup() {
  Serial.begin(115200);
  ledcSetup(CH, FREQ, RES);
  ledcAttachPin(LED, CH);
  Serial.println("esp32 fade starting");
}

void loop() {
  for (int duty = 0; duty <= 255; duty++) {
    ledcWrite(CH, duty);
    delay(6);
  }
  for (int duty = 255; duty >= 0; duty--) {
    ledcWrite(CH, duty);
    delay(6);
  }
}
