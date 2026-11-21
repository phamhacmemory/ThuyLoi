#pragma once

// Set true only after verifying UART levels and GPIO15 on the assembled board.
constexpr bool MODEM_UART_VERIFIED = false;
constexpr int MODEM_RX = 15;
constexpr int MODEM_TX = 18;
constexpr uint32_t MODEM_BAUD = 115200;
constexpr const char* APN = "";
constexpr const char* SIM_PIN = nullptr;  // e.g. "1234" only if the correct PIN is known
constexpr const char* INGEST_URL = "";    // https://your-domain/api/v1/ingest
constexpr const char* DEVICE_ID = "BB-01";
constexpr const char* DEVICE_TOKEN = "";
constexpr const char* ROOT_CA = R"PEM(
)PEM";   // PEM trust anchor for the server certificate chain

constexpr int GPS_RX = 16;
constexpr uint32_t GPS_BAUD = 9600;       // Receive-only, GPS RX line stays undriven
constexpr bool SD_PINS_VERIFIED = false;
constexpr int SD_CS = 10;
constexpr int SD_SCK = 12;
constexpr int SD_MISO = 13;
constexpr int SD_MOSI = 11;

constexpr int TEMP_PIN = -1;            // DS18B20 with external data pull-up
constexpr int BATTERY_PIN = -1;         // ADC pin with a verified physical voltage divider
constexpr float BATTERY_FACTOR = 0.0f;  // Battery voltage / voltage at the ADC input

// Optional RS485 Modbus RTU, only for a probe with documented 16-bit registers.
// UART0 is available here only with USB CDC On Boot enabled.
constexpr int PROBE_RX = -1;
constexpr int PROBE_TX = -1;
constexpr int PROBE_DE = -1;            // -1 for auto-direction transceiver
constexpr uint32_t PROBE_BAUD = 9600;
constexpr uint32_t PROBE_SERIAL_MODE = SERIAL_8N1;
constexpr uint8_t PROBE_ADDRESS = 1;
constexpr uint8_t PROBE_FUNCTION = 3;
// Set scale and offset from the probe manual and calibration.
// SAL_REG only for documented practical salinity (PSU).
constexpr int32_t EC_REG = -1;
constexpr float EC_SCALE = 1, EC_OFFSET = 0;
constexpr int32_t SAL_REG = -1;
constexpr float SAL_SCALE = 1, SAL_OFFSET = 0;

constexpr uint32_t SAMPLE_MS = 30000;
constexpr uint32_t SEND_MS = 30000;
constexpr size_t MAX_PENDING = 2880;     // approx. 24h at 30s/sample
