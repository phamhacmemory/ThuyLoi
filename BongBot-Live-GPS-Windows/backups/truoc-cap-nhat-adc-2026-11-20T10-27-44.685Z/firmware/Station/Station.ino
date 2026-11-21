#include <Arduino.h>
#include <deque>
#include <PPP.h>
#include <TinyGPS++.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <SD.h>
#include <SPI.h>
#include <esp_system.h>
#include <sys/time.h>
#include <time.h>

#if __has_include("bong_bot_local_config.h")
#include "bong_bot_local_config.h"
#else
#include "settings.example.h"
#endif

static_assert(SAMPLE_MS >= 2000 && SEND_MS >= 1000, "Invalid interval");
static_assert(!MODEM_UART_VERIFIED || (MODEM_RX != GPS_RX && MODEM_TX != GPS_RX && MODEM_TX != MODEM_RX), "UART pin conflict");
#if !defined(ARDUINO_USB_CDC_ON_BOOT) || !ARDUINO_USB_CDC_ON_BOOT
static_assert(PROBE_TX < 0, "Enable USB CDC On Boot before enabling UART0 Modbus");
#endif

TinyGPSPlus gps;
OneWire oneWire;
DallasTemperature thermometer(&oneWire);
constexpr time_t earliestClock = 1704067200; // 2024-01-01 UTC
constexpr char queueDir[] = "/pending";
constexpr char rejectedDir[] = "/rejected";
constexpr char staging[] = "/sample.tmp";
constexpr char samplePrefix[] = "/pending/";
SemaphoreHandle_t queueMutex;
size_t pendingCount = 0;
constexpr size_t RAM_QUEUE_CAPACITY = 60;
std::deque<String> ramQueue;
bool sdReady = false;
uint32_t dropped = 0;
uint32_t bootId[2];
uint32_t seq = 0;
uint32_t nextSample = 0;
bool tempPending = false;
uint32_t tempStarted = 0;

bool initializeStorage() {
  if (!SD_PINS_VERIFIED) return false;
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS,SPI,4000000)) return false;
  if ((!SD.exists(queueDir) && !SD.mkdir(queueDir)) || (!SD.exists(rejectedDir) && !SD.mkdir(rejectedDir))) return false;
  if (SD.exists(staging)) {
    const String recover = String(rejectedDir) + "/recovery-" + String(bootId[0], HEX) + ".tmp";
    if (!SD.rename(staging, recover)) return false;
    Serial.println("Recovered incomplete write to /rejected. Inspect file.");
  }
  File folder = SD.open(queueDir);
  if (!folder || !folder.isDirectory()) return false;
  for (File entry = folder.openNextFile(); entry; entry = folder.openNextFile()) {
    if (entry.isDirectory()) continue;
    const String path = entry.path();
    if (path.startsWith(samplePrefix) && path.endsWith(".json")) ++pendingCount;
  }
  return true;
}

void storeSample(const String& id, const String& payload) {
  bool saved = false;
  xSemaphoreTake(queueMutex,portMAX_DELAY);
  if (!SD_PINS_VERIFIED) {
    if (ramQueue.size() >= RAM_QUEUE_CAPACITY) {
      ramQueue.pop_front();
      if (dropped < UINT32_MAX) ++dropped;
    }
    ramQueue.push_back(payload);
    saved = true;
  } else if (sdReady && pendingCount < MAX_PENDING) {
    const String path = String(samplePrefix) + id + ".json";
    File file = SD.open(staging, FILE_WRITE);
    if (file) {
      const size_t count = file.print(payload);
      file.flush();
      file.close();
      if (count == payload.length() && SD.rename(staging, path)) {
        ++pendingCount;
        saved = true;
      } else if (SD.exists(staging) && !SD.remove(staging)) sdReady = false;
    }
  }
  const auto queued = SD_PINS_VERIFIED ? pendingCount : ramQueue.size();
  xSemaphoreGive(queueMutex);
  if (!saved && dropped < UINT32_MAX) ++dropped;
  Serial.printf("sample %s | stored=%d | pending=%u | dropped=%lu\n",id.c_str(),saved,static_cast<unsigned>(queued),static_cast<unsigned long>(dropped));
}

uint16_t crcModbus(const uint8_t* bytes,size_t count) {
  uint16_t crc=0xffff;
  for (size_t i=0; i<count; ++i) {
    crc ^= bytes[i];
    for (int bit=0; bit<8; ++bit) crc=(crc&1) ? (crc>>1)^0xa001 : crc>>1;
  }
  return crc;
}
void readGps() {
  while (Serial1.available()) gps.encode(Serial1.read());
}
float probe(int32_t reg, float scale, float offset) {
  if (PROBE_RX < 0 || PROBE_TX < 0 || reg < 0 || reg > 65535) return NAN;
  while(Serial0.available()) Serial0.read();
  uint8_t request[] = {PROBE_ADDRESS,PROBE_FUNCTION,uint8_t(reg>>8),uint8_t(reg),0,1,0,0};
  const uint16_t checksum=crcModbus(request,6);
  request[6]=checksum&255;
  request[7]=checksum>>8;
  if (PROBE_DE>=0) digitalWrite(PROBE_DE,HIGH);
  Serial0.write(request,sizeof request);
  Serial0.flush(true);
  if (PROBE_DE>=0) digitalWrite(PROBE_DE,LOW);
  uint8_t buf[7];
  size_t used=0;
  const auto started=millis();
  while (used < sizeof buf && millis()-started<350) {
    readGps();
    if (Serial0.available()) buf[used++]=Serial0.read();
    else delay(1);
  }
  if (used != sizeof buf || buf[0]!=PROBE_ADDRESS || buf[1]!=PROBE_FUNCTION || buf[2]!=2 ||
      crcModbus(buf,5)!=(uint16_t(buf[5])|(uint16_t(buf[6])<<8))) return NAN;
  return float((unsigned(buf[3])<<8)|buf[4])*scale+offset;
}
String field(double value,double min,double max,unsigned precision=2) {
  return isfinite(value) && value>=min && value<=max ? String(value,precision) : String("null");
}
void synchronizeGpsClock() {
  if (!gps.date.isValid() || !gps.time.isValid() || gps.date.age()>2500 || gps.time.age()>1500 || gps.date.year()<2024) return;
  struct tm date = {};
  date.tm_year=gps.date.year()-1900;
  date.tm_mon=gps.date.month()-1;
  date.tm_mday=gps.date.day();
  date.tm_hour=gps.time.hour();
  date.tm_min=gps.time.minute();
  date.tm_sec=gps.time.second();
  const time_t utc=mktime(&date);
  if (utc < earliestClock || llabs(static_cast<long long>(time(nullptr))-utc)<=3) return;
  struct timeval tv = {utc,0};
  settimeofday(&tv,nullptr);
}
void recordSample(float temperature) {
  char id[32];
  snprintf(id,sizeof id,"%08lx%08lx%08lx",static_cast<unsigned long>(bootId[0]),static_cast<unsigned long>(bootId[1]),static_cast<unsigned long>(seq++));
  const bool fix=gps.location.isValid() && gps.location.age()<5000;
  const auto utc=time(nullptr);
  char timestamp[24] = "null";
  if (utc>=earliestClock) snprintf(timestamp,sizeof timestamp,"%lld",static_cast<long long>(utc)*1000);
  const float ec = probe(EC_REG,EC_SCALE,EC_OFFSET);
  if (EC_REG>=0 && SAL_REG>=0) delay(20);
  const float salinity = probe(SAL_REG,SAL_SCALE,SAL_OFFSET);
  const float battery = BATTERY_PIN>=0 && BATTERY_FACTOR>0 ? analogReadMilliVolts(BATTERY_PIN)*0.001f*BATTERY_FACTOR : NAN;
  String body;
  body.reserve(360);
  body = "{\"sample_id\":\"";
  body += id;
  body += "\",\"measured_at\":";
  body += timestamp;
  body += ",\"lat\":" + (fix ? field(gps.location.lat(),-90,90,7) : String("null"));
  body += ",\"lng\":" + (fix ? field(gps.location.lng(),-180,180,7) : String("null"));
  body += ",\"hdop\":" + (fix && gps.hdop.isValid() && gps.hdop.age()<5000 ? field(gps.hdop.hdop(),0,99.99) : String("null"));
  body += ",\"satellites\":" + (fix && gps.satellites.isValid() && gps.satellites.age()<5000 ? field(gps.satellites.value(),0,100,0) : String("null"));
  body += ",\"temp_c\":" + field(temperature,-55,125);
  body += ",\"ec_us_cm\":" + field(ec,0,300000);
  body += ",\"salinity_psu\":" + field(salinity,0,80);
  body += ",\"battery_v\":" + field(battery,0,100);
  body += ",\"dropped\":" + String(dropped) + "}";
  if (fix) Serial.printf("GPS fix: %.6f, %.6f\n",gps.location.lat(),gps.location.lng());
  else Serial.printf("Waiting for GPS fix, NMEA chars=%lu\n",static_cast<unsigned long>(gps.charsProcessed()));
  storeSample(id,body);
}

void closeModem() {
  if (PPP.handle() && PPP.mode() != ESP_MODEM_MODE_COMMAND) PPP.mode(ESP_MODEM_MODE_COMMAND);
  PPP.end();
}
bool connectModem() {
  closeModem();
  PPP.setApn(APN);
  if (SIM_PIN) PPP.setPin(SIM_PIN);
  if (!PPP.setPins(MODEM_TX,MODEM_RX) || !PPP.begin(PPP_MODEM_SIM7600,2,MODEM_BAUD)) return false;
  const auto started=millis();
  while (millis()-started<55000) {
    if (PPP.attached()) {
      const auto port = PPP.mode(ESP_MODEM_MODE_DATA);
      if (!port || !PPP.waitStatusBits(ESP_NETIF_HAS_IP_BIT,25000)) return false;
      PPP.setDefault();
      return true;
    }
    delay(600);
  }
  return false;
}
int post(const String& body) {
  NetworkClientSecure tls;
  tls.setCACert(ROOT_CA);
  tls.setHandshakeTimeout(12);
  HTTPClient https;
  https.setConnectTimeout(10000);
  https.setTimeout(12000);
  if (!https.begin(tls,INGEST_URL)) return -1;
  https.addHeader("Content-Type","application/json");
  https.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);
  https.addHeader("X-Device-Id",DEVICE_ID);
  const int status = https.POST(body);
  https.end();
  return status;
}
bool sendNext() {
  if (!SD_PINS_VERIFIED) {
    xSemaphoreTake(queueMutex,portMAX_DELAY);
    const String body=ramQueue.empty() ? String() : ramQueue.front();
    xSemaphoreGive(queueMutex);
    if (body.isEmpty()) return false;
    const int status=post(body);
    Serial.printf("RAM upload: HTTP %d\n",status);
    if (status==200 || status==201 || status==400 || status==409 || status==413 || status==422) {
      xSemaphoreTake(queueMutex,portMAX_DELAY);
      if (!ramQueue.empty() && ramQueue.front()==body) ramQueue.pop_front();
      xSemaphoreGive(queueMutex);
      return true;
    }
    return false;
  }
  xSemaphoreTake(queueMutex,portMAX_DELAY);
  if (pendingCount == 0) { xSemaphoreGive(queueMutex); return false; }
  File folder=SD.open(queueDir);
  File file;
  String path;
  if (folder && folder.isDirectory()) {
    for (file=folder.openNextFile(); file; file=folder.openNextFile()) {
      if (file.isDirectory()) continue;
      path=file.path();
      if (path.startsWith(samplePrefix) && path.endsWith(".json")) break;
    }
  }
  const bool readable=bool(file);
  const bool sizeOk=readable && file.size()>0 && file.size()<=4096;
  String body=sizeOk ? file.readString() : String();
  if (file) file.close();
  if (folder) folder.close();
  xSemaphoreGive(queueMutex);
  if (!readable) { Serial.println("Cannot read SD sample"); return false; }
  const int status=sizeOk && !body.isEmpty() ? post(body) : 422;
  const bool accepted = status==200 || status==201;
  const bool invalid = status==400 || status==409 || status==413 || status==422;
  if (!accepted && !invalid) { Serial.printf("Upload deferred, HTTP %d\n",status); return false; }
  xSemaphoreTake(queueMutex,portMAX_DELAY);
  const bool committed = accepted ? SD.remove(path) : SD.rename(path,String(rejectedDir)+"/"+path.substring(strlen(samplePrefix)));
  if (committed) --pendingCount;
  xSemaphoreGive(queueMutex);
  Serial.printf("HTTP %d | %s\n",status,committed?(accepted?"committed":"moved to rejected"):"SD update failed");
  return committed;
}
void networkTask(void*) {
  uint32_t retry=5000;
  for (;;) {
    if (!PPP.hasIP()) {
      if (!connectModem()) {
        Serial.println("PPP unavailable; check SIM, APN and modem firmware.");
        closeModem();
        delay(retry);
        retry=min<uint32_t>(retry * 2, 120000u);
        continue;
      }
      retry=5000;
      Serial.print("PPP IP: ");
      Serial.println(PPP.localIP());
      configTime(0,0,"time.cloudflare.com","pool.ntp.org");
    }
    if (time(nullptr)>=earliestClock) {
      for (unsigned count=0;count<12 && PPP.hasIP();++count) {
        if (!sendNext()) break;
        delay(35);
      }
    } else Serial.println("Waiting for UTC from GPS or SNTP before TLS");
    delay(SEND_MS);
  }
}
void setup() {
  Serial.begin(115200);
  setenv("TZ","UTC0",1);
  tzset();
  esp_fill_random(bootId,sizeof bootId);
  Serial1.setRxBufferSize(1024);
  Serial1.begin(GPS_BAUD,SERIAL_8N1,GPS_RX,-1);
  queueMutex=xSemaphoreCreateMutex();
  if (!queueMutex) { Serial.println("Cannot allocate queue mutex"); return; }
  sdReady=initializeStorage();
  if (!SD_PINS_VERIFIED) Serial.println("RAM queue enabled (60 samples); enable verified SD for power-loss persistence.");
  else if (!sdReady) Serial.println("SD not ready; samples cannot be queued.");
  if (TEMP_PIN>=0) {
    oneWire.begin(TEMP_PIN);
    thermometer.begin();
    thermometer.setWaitForConversion(false);
  }
  if (PROBE_RX>=0 && PROBE_TX>=0) {
    if (PROBE_DE>=0) { pinMode(PROBE_DE,OUTPUT); digitalWrite(PROBE_DE,LOW); }
    Serial0.begin(PROBE_BAUD,PROBE_SERIAL_MODE,PROBE_RX,PROBE_TX);
  }
  if (MODEM_UART_VERIFIED && *APN && String(INGEST_URL).startsWith("https://") &&
      strlen(DEVICE_TOKEN)==64 && strstr(ROOT_CA,"-----BEGIN CERTIFICATE-----")) {
    if (xTaskCreate(networkTask,"lte",12288,nullptr,1,nullptr)!=pdPASS) Serial.println("Could not start LTE task");
  } else Serial.println("LTE disabled: check wiring verification, APN, endpoint, device token and CA.");
}
void loop() {
  if (!queueMutex) { delay(1000); return; }
  readGps();
  synchronizeGpsClock();
  const auto now=millis();
  if (static_cast<int32_t>(now-nextSample)>=0 && !tempPending) {
    nextSample=now+SAMPLE_MS;
    if (TEMP_PIN>=0) {
      thermometer.requestTemperatures();
      tempPending=true;
      tempStarted=now;
    } else recordSample(NAN);
  }
  if (tempPending && now-tempStarted>=760) {
    tempPending=false;
    recordSample(thermometer.getTempCByIndex(0));
  }
  delay(3);
}
