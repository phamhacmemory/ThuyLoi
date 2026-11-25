#pragma once

// UART configuration from the supplied BB-01 firmware.
constexpr int MODEM_RX = 18;
constexpr int MODEM_TX = 15;
constexpr uint32_t MODEM_BAUD = 9600;
#define STATION_APN "m-wap.mnc001.mcc452.gprs"
constexpr const char* SIM_PIN = nullptr;  // e.g. "1234" only if the correct PIN is known
constexpr const char* INGEST_URL = "https://rjvcrcskqslirypvzljf.supabase.co/functions/v1/ingest";
constexpr const char* ROOT_CA = R"PEM(
-----BEGIN CERTIFICATE-----
MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG
A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv
b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw
MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i
YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT
aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ
jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp
xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp
1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG
snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ
U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8
9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E
BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B
AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz
yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE
38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP
AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad
DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME
HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==
-----END CERTIFICATE-----
)PEM";   // PEM trust anchor for the server certificate chain

constexpr int GPS_RX = 16;
constexpr uint32_t GPS_BAUD = 9600;       // Receive-only, GPS RX line stays undriven
constexpr bool SD_PINS_VERIFIED = true;
constexpr int SD_CS = 10;
constexpr int SD_SCK = 12;
constexpr int SD_MISO = 13;
constexpr int SD_MOSI = 11;
#define ENABLE_DS18B20 0
#define SALINITY_ADC_PIN 4
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
