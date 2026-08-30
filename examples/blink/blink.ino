// blink.ino - a classic Arduino sketch. Runs on real hardware (Verify/Upload
// with a board selected) AND in the Cortex Simulator (no hardware needed):
// open the Simulator (left activity bar) and press Run.
//
// Default sim components: an LED on D13 and a button on D2. Hold the button
// to force the LED on; release to resume blinking.

const int LED = 13;
const int BUTTON = 2;

unsigned long lastToggle = 0;
bool ledOn = false;

void setup() {
  pinMode(LED, OUTPUT);
  pinMode(BUTTON, INPUT_PULLUP);
  Serial.begin(115200);
  Serial.println("blink starting");
}

void loop() {
  // Button pressed (INPUT_PULLUP reads LOW when pressed) -> LED solid on.
  if (digitalRead(BUTTON) == LOW) {
    digitalWrite(LED, HIGH);
    return;
  }

  // Otherwise blink every 300 ms without blocking.
  if (millis() - lastToggle >= 300) {
    lastToggle = millis();
    ledOn = !ledOn;
    digitalWrite(LED, ledOn ? HIGH : LOW);
    Serial.println(ledOn ? "on" : "off");
  }
}
