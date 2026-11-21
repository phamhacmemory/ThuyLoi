#include <Arduino.h>

// Enable only after tracing GPIO15 and checking UART levels on the assembled board.
constexpr bool UART_VERIFIED = false;
constexpr int MODEM_RX = 15;  // ESP RX <- modem UTX
constexpr int MODEM_TX = 18;  // ESP TX -> modem URX
constexpr uint32_t MODEM_BAUD = 115200;
HardwareSerial modem(2);
String input;

void checkStatus() {
  const char* commands[] = {"AT", "ATI", "AT+CPIN?", "AT+CSQ", "AT+CEREG?", "AT+COPS?", "AT+CGATT?", "AT+CGDCONT?", "AT+CGPADDR=1"};
  for (const char* command : commands) {
    Serial.printf("\n> %s\n", command);
    modem.print(command);
    modem.print('\r');
    String line;
    const uint32_t started = millis();
    while (millis() - started < 3500) {
      if (modem.available()) {
        const char c = modem.read();
        Serial.write(c);
        if (c == '\n') {
          line.trim();
          if (line == "OK" || line == "ERROR" || line.startsWith("+CME ERROR")) break;
          line = "";
        } else if (line.length() < 160) line += c;
      } else delay(2);
    }
  }
}
void setup() {
  Serial.begin(115200);
  delay(1000);
  if (!UART_VERIFIED) {
    Serial.println("UART disabled. Verify wiring and levels, then set UART_VERIFIED=true.");
    return;
  }
  modem.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX, MODEM_TX);
  Serial.println("Send ? for SIM and network status. Or send an AT command with New Line.");
}
void loop() {
  if (!UART_VERIFIED) { delay(1000); return; }
  while (modem.available()) Serial.write(modem.read());
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\r' || c == '\n') {
      input.trim();
      if (input == "?") checkStatus();
      else if (input.startsWith("AT")) { modem.print(input); modem.print('\r'); }
      input = "";
    } else if (input.length() < 220) input += c;
  }
  delay(2);
}
