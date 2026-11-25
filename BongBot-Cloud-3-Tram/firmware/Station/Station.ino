#include <Arduino.h>
#include <deque>
#include <PPP.h>
#include <Preferences.h>
#include <TinyGPS++.h>
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

// Add #define ENABLE_DS18B20 1 in bong_bot_local_config.h when using DS18B20.
#ifndef ENABLE_DS18B20
#define ENABLE_DS18B20 0
#endif
#if ENABLE_DS18B20
#include <OneWire.h>
#include <DallasTemperature.h>
#endif

// Set #define SALINITY_ADC_PIN 4 in the local header for an analog probe.
#ifndef SALINITY_ADC_PIN
#define SALINITY_ADC_PIN -1
#endif
static_assert(SALINITY_ADC_PIN == -1 || SALINITY_ADC_PIN == 4, "Use verified GPIO4 for the analog probe");
static_assert(SALINITY_ADC_PIN < 0 || (SALINITY_ADC_PIN != TEMP_PIN && SALINITY_ADC_PIN != BATTERY_PIN &&
  SALINITY_ADC_PIN != GPS_RX && SALINITY_ADC_PIN != MODEM_RX && SALINITY_ADC_PIN != MODEM_TX &&
  SALINITY_ADC_PIN != PROBE_RX && SALINITY_ADC_PIN != PROBE_TX && SALINITY_ADC_PIN != PROBE_DE &&
  (!SD_PINS_VERIFIED || (SALINITY_ADC_PIN != SD_CS && SALINITY_ADC_PIN != SD_SCK &&
     SALINITY_ADC_PIN != SD_MISO && SALINITY_ADC_PIN != SD_MOSI))), "GPIO4 already assigned");

// DS1307 is optional. Enable only after verifying the I2C voltage and pins.
#ifndef ENABLE_DS1307
#define ENABLE_DS1307 0
#endif
#if ENABLE_DS1307
#include <Wire.h>
#ifndef RTC_SDA_PIN
#define RTC_SDA_PIN 8
#endif
#ifndef RTC_SCL_PIN
#define RTC_SCL_PIN 9
#endif
constexpr bool rtcPinAvailable(int pin) {
  return pin >= 0 && pin != GPS_RX && pin != MODEM_RX && pin != MODEM_TX &&
    pin != TEMP_PIN && pin != BATTERY_PIN && pin != SALINITY_ADC_PIN &&
    pin != PROBE_RX && pin != PROBE_TX && pin != PROBE_DE &&
    (!SD_PINS_VERIFIED || (pin != SD_CS && pin != SD_SCK && pin != SD_MOSI && pin != SD_MISO));
}
static_assert(RTC_SDA_PIN != RTC_SCL_PIN && rtcPinAvailable(RTC_SDA_PIN) &&
  rtcPinAvailable(RTC_SCL_PIN), "RTC pins conflict with another peripheral");
#endif

static_assert(SAMPLE_MS >= 2000 && SEND_MS >= 1000, "Invalid interval");
static_assert(GPS_RX != 15 && GPS_RX != 18, "GPS pin conflicts with modem");
#if !defined(ARDUINO_USB_CDC_ON_BOOT) || !ARDUINO_USB_CDC_ON_BOOT
static_assert(PROBE_TX < 0, "Enable USB CDC On Boot before enabling UART0 Modbus");
#endif

TinyGPSPlus gps;
#if ENABLE_DS18B20
OneWire oneWire;
DallasTemperature thermometer(&oneWire);
#endif
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
#if ENABLE_DS18B20
bool tempPending = false;
uint32_t tempStarted = 0;
#endif

String payloadId(const String& body) {
  constexpr char prefix[] = "{\"sample_id\":\"";
  constexpr unsigned offset = sizeof(prefix) - 1;
  constexpr unsigned idLength = 24;
  if (!body.startsWith(prefix) || !body.endsWith("}") ||
      body.length() <= offset + idLength || body[offset + idLength] != '"') return {};
  for (unsigned i = offset; i < offset + idLength; ++i) {
    const char ch = body[i];
    if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return {};
  }
  return body.substring(offset, offset + idLength);
}

bool recoverStaging() {
  if (!SD.exists(staging)) return true;
  File file = SD.open(staging, FILE_READ);
  if (!file) return false;
  const String body = file.size() <= 4096 ? file.readString() : String();
  file.close();
  const String id = payloadId(body);
  if (!id.isEmpty()) {
    const String pendingPath = String(samplePrefix) + id + ".json";
    if (!SD.exists(pendingPath)) {
      if (!SD.rename(staging, pendingPath)) return false;
      Serial.printf("SD recovered pending sample %s\n",id.c_str());
      return true;
    }
  }
  const String rejected = String(rejectedDir) + "/recovery-" + String(bootId[0], HEX) + ".tmp";
  if (!SD.rename(staging, rejected)) return false;
  Serial.println("SD partial/duplicate staging retained under /rejected.");
  return true;
}

bool initializeStorage() {
  if (!SD_PINS_VERIFIED) return false;
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS,SPI,4000000)) return false;
  if ((!SD.exists(queueDir) && !SD.mkdir(queueDir)) || (!SD.exists(rejectedDir) && !SD.mkdir(rejectedDir))) return false;
  if (!recoverStaging()) return false;
  File folder = SD.open(queueDir);
  if (!folder || !folder.isDirectory()) return false;
  for (File entry = folder.openNextFile(); entry; entry = folder.openNextFile()) {
    if (entry.isDirectory()) continue;
    const String path = entry.path();
    if (path.startsWith(samplePrefix) && path.endsWith(".json")) ++pendingCount;
  }
  Serial.printf("SD ready: %u pending file(s)\n",static_cast<unsigned>(pendingCount));
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
      } else {
        sdReady = false;
        Serial.println("SD staged data retained. Check the card and restart to recover.");
      }
    }
  }
  if (SD_PINS_VERIFIED && !saved && pendingCount >= MAX_PENDING) {
    Serial.println("SD queue limit reached; oldest unacknowledged files retained.");
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
#if ENABLE_DS1307
constexpr uint8_t rtcAddress = 0x68;
constexpr uint8_t utcMarkerAddress = 0x08;
constexpr uint8_t utcMarker[] = {'B','B','U','1'};
bool rtcBusReady = false;
time_t lastRtcSync = 0;

bool rtcRead(uint8_t address, uint8_t* out, size_t count) {
  Wire.beginTransmission(rtcAddress);
  Wire.write(address);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(rtcAddress,count) != count) return false;
  for (size_t i=0;i<count;++i) out[i]=uint8_t(Wire.read());
  return true;
}
bool rtcWrite(uint8_t address,const uint8_t* bytes,size_t count) {
  Wire.beginTransmission(rtcAddress);
  Wire.write(address);
  Wire.write(bytes,count);
  return Wire.endTransmission()==0;
}
int fromBcd(uint8_t value) {
  if ((value & 15)>9 || (value >> 4)>9) return -1;
  return (value >> 4)*10+(value & 15);
}
uint8_t toBcd(int value) { return uint8_t((value/10)*16+value%10); }

time_t rtcTime() {
  uint8_t marker[sizeof utcMarker], regs[7];
  if (!rtcRead(utcMarkerAddress,marker,sizeof marker) ||
      memcmp(marker,utcMarker,sizeof marker)!=0 ||
      !rtcRead(0,regs,sizeof regs) || (regs[0]&0x80) || (regs[2]&0x40)) return 0;
  const int second=fromBcd(regs[0]&0x7f), minute=fromBcd(regs[1]&0x7f);
  const int hour=fromBcd(regs[2]&0x3f), day=fromBcd(regs[4]&0x3f);
  const int month=fromBcd(regs[5]&0x1f), year=fromBcd(regs[6]);
  if(second<0||second>59||minute<0||minute>59||hour<0||hour>23||
     day<1||day>31||month<1||month>12||year<24) return 0;
  struct tm date = {};
  date.tm_sec=second; date.tm_min=minute; date.tm_hour=hour;
  date.tm_mday=day; date.tm_mon=month-1; date.tm_year=year+100;
  const time_t utc=mktime(&date);
  return utc>=earliestClock && date.tm_mday==day && date.tm_mon==month-1 ? utc : 0;
}

bool writeRtcUtc(time_t utc) {
  struct tm date;
  if (utc<earliestClock || !gmtime_r(&utc,&date) || date.tm_year<124 || date.tm_year>199) return false;
  const uint8_t regs[] = {toBcd(date.tm_sec),toBcd(date.tm_min),toBcd(date.tm_hour),
    toBcd(date.tm_wday+1),toBcd(date.tm_mday),toBcd(date.tm_mon+1),toBcd(date.tm_year-100)};
  const uint8_t invalid[sizeof utcMarker] = {};
  return rtcWrite(utcMarkerAddress,invalid,sizeof invalid) && rtcWrite(0,regs,sizeof regs) &&
    rtcWrite(utcMarkerAddress,utcMarker,sizeof utcMarker);
}

void initializeRtc() {
  rtcBusReady=Wire.begin(RTC_SDA_PIN,RTC_SCL_PIN,100000);
  if (!rtcBusReady) { Serial.println("RTC I2C start failed."); return; }
  Wire.setTimeOut(40);
  const auto utc=rtcTime();
  if (utc>=earliestClock) {
    struct timeval tv={utc,0};
    settimeofday(&tv,nullptr);
    Serial.println("RTC UTC restored.");
  } else Serial.println("RTC has no verified UTC; wait for GPS time.");
}

void syncRtcFromGps(time_t utc) {
  if (!rtcBusReady || (lastRtcSync && llabs(static_cast<long long>(utc)-lastRtcSync) < 21600)) return;
  // Record the attempt even if the module is absent, to avoid repeated I2C writes.
  lastRtcSync=utc;
  if (writeRtcUtc(utc)) Serial.println("RTC UTC synced from GPS.");
  else Serial.println("RTC UTC sync failed; GPS still sets the ESP clock.");
}
#endif

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
  if (utc < earliestClock) return;
  if (llabs(static_cast<long long>(time(nullptr))-utc)>3) {
    struct timeval tv = {utc,0};
    settimeofday(&tv,nullptr);
  }
#if ENABLE_DS1307
  syncRtcFromGps(utc);
#endif
}
int readProbeAdc() {
#if SALINITY_ADC_PIN == 4
  unsigned sum = 0;
  for (unsigned i = 0; i < 16; ++i) sum += analogRead(SALINITY_ADC_PIN);
  return static_cast<int>((sum + 8) / 16);
#else
  return -1;
#endif
}

// BEGIN GPIO4 curve helpers
#if (defined(SALINITY_ADC_CAL_POINTS) + defined(SALINITY_ADC_EC25_POINTS) + defined(SALINITY_ADC_EC_POINTS)) > 1
#error Choose one GPIO4 calibration table
#endif
#if (defined(SALINITY_ADC_EC25_POINTS) || defined(SALINITY_ADC_EC_POINTS)) && SALINITY_ADC_PIN != 4
#error Enable SALINITY_ADC_PIN 4 before configuring a GPIO4 EC table
#endif
#if defined(SALINITY_ADC_EC_POINTS)
static_assert(ENABLE_DS18B20 && TEMP_PIN>=0, "Actual EC needs DS18B20 temperature on a separate GPIO");
#endif

#if SALINITY_ADC_PIN == 4
#if defined(SALINITY_ADC_CAL_POINTS) || defined(SALINITY_ADC_EC25_POINTS) || defined(SALINITY_ADC_EC_POINTS)
struct SalinityCalibrationPoint {
  int adc;
  float value;
};

#if defined(SALINITY_ADC_EC25_POINTS)
constexpr SalinityCalibrationPoint salinityCalibration[] = SALINITY_ADC_EC25_POINTS;
constexpr float calibrationMaximum=300.0f;  // mS/cm; PSU validity is checked separately.
#elif defined(SALINITY_ADC_EC_POINTS)
constexpr SalinityCalibrationPoint salinityCalibration[] = SALINITY_ADC_EC_POINTS;
constexpr float calibrationMaximum=300.0f;
#else
constexpr SalinityCalibrationPoint salinityCalibration[] = SALINITY_ADC_CAL_POINTS;
constexpr float calibrationMaximum=80.0f;
#endif
constexpr size_t salinityPointCount=sizeof salinityCalibration/sizeof salinityCalibration[0];

constexpr bool validSalinityCalibration() {
  if (salinityPointCount<2) return false;
  const bool increasing=salinityCalibration[1].value>salinityCalibration[0].value;
  for (size_t i=0;i<salinityPointCount;++i) {
    const auto point=salinityCalibration[i];
    if (point.adc<=0 || point.adc>=4095 || !(point.value>=0 && point.value<=calibrationMaximum)) return false;
    if (i==0) continue;
    const auto previous=salinityCalibration[i-1];
    if (point.adc<=previous.adc ||
        (increasing ? point.value<=previous.value : point.value>=previous.value)) return false;
  }
  return true;
}
static_assert(validSalinityCalibration(),
    "Use 2+ calibration points: increasing ADC and strictly monotonic conductivity or salinity");

float calibratedAdc(int adc) {
  if (adc<salinityCalibration[0].adc || adc>salinityCalibration[salinityPointCount-1].adc) return NAN;
  for (size_t i=1;i<salinityPointCount;++i) {
    const auto right=salinityCalibration[i];
    if (adc>right.adc) continue;
    const auto left=salinityCalibration[i-1];
    const float ratio=float(adc-left.adc)/float(right.adc-left.adc);
    return left.value+ratio*(right.value-left.value);
  }
  return NAN;
}
#else
float calibratedAdc(int) { return NAN; }
#endif

#if defined(SALINITY_ADC_EC25_POINTS) || defined(SALINITY_ADC_EC_POINTS)
// Equations from UNESCO PSS-78 and the TEOS-10 Appendix E / Hill extension.
// https://teos-10.org/pubs/gsw/pdf/SP_from_C.pdf
double evaluatePss78(double rootRatio,double temperatureTerm) {
  const double base[]={0.0080,-0.1692,25.3851,14.0941,-7.0261,2.7081};
  const double thermal[]={0.0005,-0.0056,-0.0066,-0.0375,0.0636,-0.0144};
  double salinity=0, correction=0;
  for (int i=5;i>=0;--i) {
    salinity=salinity*rootRatio+base[i];
    correction=correction*rootRatio+thermal[i];
  }
  return salinity+temperatureTerm*correction;
}

double hillAdjusted(double rootRatio,double temperatureTerm,double salinity) {
  const double x=400.0*rootRatio*rootRatio;
  const double y=10.0*rootRatio;
  return salinity-0.0080/(1+x*(1.5+x))-0.0005*temperatureTerm/(1+y*(1+y*(1+y)));
}

float conductivityToPss78(double ecMilliSiemens,double waterC) {
  if (!isfinite(ecMilliSiemens) || ecMilliSiemens<0 ||
      !isfinite(waterC) || waterC< -2.0 || waterC>35.0) return NAN;
  if (ecMilliSiemens==0) return 0;
  const double t68=waterC*1.00024;
  const double thermalRatio=0.6766097+t68*(0.0200564+t68*(0.0001104259+
    t68*(-0.00000069698+t68*0.0000000010031)));
  const double temperatureTerm=(t68-15)/(1+0.0162*(t68-15));
  // Surface water, sea pressure p=0 dbar.
  const double rootRatio=sqrt(ecMilliSiemens/(42.9140*thermalRatio));
  double salinity=evaluatePss78(rootRatio,temperatureTerm);
  if (salinity<2) {
    // Find the transition at SP=2 and enforce continuity with the Hill curve.
    double left=0,right=1;
    for (int i=0;i<40;++i) {
      const double mid=(left+right)*0.5;
      if (evaluatePss78(mid,temperatureTerm)<2) left=mid;
      else right=mid;
    }
    const double scale=2.0/hillAdjusted((left+right)*0.5,temperatureTerm,2.0);
    salinity=scale*hillAdjusted(rootRatio,temperatureTerm,salinity);
  }
  if (salinity>42.0+1e-6 || salinity< -1e-9 || !isfinite(salinity)) return NAN;
  return float(salinity<0 ? 0 : salinity>42 ? 42 : salinity);
}
#endif
#endif
// END GPIO4 curve helpers

void recordSample(float temperature) {
  char id[32];
  snprintf(id,sizeof id,"%08lx%08lx%08lx",static_cast<unsigned long>(bootId[0]),static_cast<unsigned long>(bootId[1]),static_cast<unsigned long>(seq++));
  const bool fix=gps.location.isValid() && gps.location.age()<5000;
  struct timeval captured = {};
  gettimeofday(&captured,nullptr);
  char timestamp[24] = "null";
  if (captured.tv_sec>=earliestClock) {
    const long long ms=static_cast<long long>(captured.tv_sec)*1000 + captured.tv_usec/1000;
    snprintf(timestamp,sizeof timestamp,"%lld",ms);
  } else {
    Serial.println("No UTC at collection: measured_at=null; sample retained.");
  }
  const int adc = readProbeAdc();
#if defined(SALINITY_ADC_EC25_POINTS) || defined(SALINITY_ADC_EC_POINTS)
  const float ecMillis = calibratedAdc(adc);
  const float ec = ecMillis * 1000.0f;
#if defined(SALINITY_ADC_EC25_POINTS)
  const float salinity = conductivityToPss78(ecMillis,25.0);
#else
  const float salinity = conductivityToPss78(ecMillis,temperature);
#endif
#else
  const float ec = probe(EC_REG,EC_SCALE,EC_OFFSET);
#if SALINITY_ADC_PIN == 4
  const float salinity = calibratedAdc(adc);
#else
  if (EC_REG>=0 && SAL_REG>=0) delay(20);
  const float salinity = probe(SAL_REG,SAL_SCALE,SAL_OFFSET);
#endif
#endif
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
  body += ",\"salinity_adc_raw\":" + (adc < 0 ? String("null") : String(adc));
  body += ",\"dropped\":" + String(dropped) + "}";
  if (adc >= 0) {
    Serial.printf("GPIO%d probe ADC: %d/4095\n",SALINITY_ADC_PIN,adc);
#if defined(SALINITY_ADC_EC25_POINTS)
    if (isfinite(ec)) Serial.printf("GPIO4 EC25: %.1f uS/cm\n",ec);
#elif defined(SALINITY_ADC_EC_POINTS)
    if (isfinite(ec)) Serial.printf("GPIO4 conductivity: %.1f uS/cm at %.2f C\n",ec,temperature);
#endif
    if (isfinite(salinity)) Serial.printf("GPIO%d calibrated salinity: %.2f PSU\n",SALINITY_ADC_PIN,salinity);
#if defined(SALINITY_ADC_EC25_POINTS) || defined(SALINITY_ADC_EC_POINTS)
    else Serial.println("PSS-78 unavailable: check calibrated EC/temperature range.");
#elif defined(SALINITY_ADC_CAL_POINTS)
    else Serial.println("ADC outside calibrated range; salinity_psu=null.");
#else
    else Serial.println("GPIO4 calibration not configured; salinity_psu=null.");
#endif
  }
  if (fix) Serial.printf("GPS fix: %.6f, %.6f\n",gps.location.lat(),gps.location.lng());
  else Serial.printf("Waiting for GPS fix, NMEA chars=%lu\n",static_cast<unsigned long>(gps.charsProcessed()));
  storeSample(id,body);
}

struct CloudStation {
  char id[49];
  char token[65];
  char apn[101];
  int rx;
  int tx;
  unsigned long baud;
};
CloudStation cloudStation{};
bool validStation(const CloudStation& value);

bool validStation(const CloudStation& value) {
  if (!*value.id || strlen(value.token)!=64 || !*value.apn) return false;
  for (const char* p=value.id; *p; ++p)
    if (!(isupper((unsigned char)*p) || isdigit((unsigned char)*p) || *p=='_' || *p=='-')) return false;
  for (const char* p=value.token; *p; ++p)
    if (!(isdigit((unsigned char)*p) || (*p>='a' && *p<='f'))) return false;
  for (const char* p=value.apn; *p; ++p)
    if (!(isalnum((unsigned char)*p) || *p=='.' || *p=='-')) return false;
  if (!((value.rx==15 && value.tx==18) || (value.rx==18 && value.tx==15))) return false;
  return value.baud==9600 || value.baud==19200 || value.baud==38400 || value.baud==57600 || value.baud==115200;
}

bool loadCloudStation() {
  Preferences prefs;
  if (!prefs.begin("bb-cloud",false)) {Serial.println("NVS unavailable.");return false;}
  bool configured=prefs.getBytesLength("profile") == sizeof cloudStation &&
    prefs.getBytes("profile",&cloudStation,sizeof cloudStation)==sizeof cloudStation;
  cloudStation.id[48]=cloudStation.token[64]=cloudStation.apn[100]='\0';
  configured=configured && validStation(cloudStation);
  Serial.println("USB setup: send SET <id> <token> <rx> <tx> <baud> <apn> now.");
  String line;
  bool overflow=false;
  const uint32_t start=millis();
  while (millis()-start<12000) {
    if (!Serial.available()) {delay(10);continue;}
    const char c=char(Serial.read());
    if (c=='\n' || c=='\r') {
      line.trim();
      if (!overflow && line.startsWith("SET ")) {
        CloudStation next{};
        char extra;
        const int n=sscanf(line.c_str(),"SET %48s %64s %d %d %lu %100s %c",
          next.id,next.token,&next.rx,&next.tx,&next.baud,next.apn,&extra);
        if (n!=6 || !validStation(next)) Serial.println("Invalid station profile.");
        else if (configured && strcmp(cloudStation.id,next.id)!=0) Serial.println("Station ID already assigned; keep SD associated with its station.");
        else if (prefs.putBytes("profile",&next,sizeof next)!=sizeof next) Serial.println("Could not save station profile.");
        else {cloudStation=next;configured=true;Serial.println("Station profile saved.");break;}
      }
      line="";
      overflow=false;
    } else if (line.length()<250) line+=c;
    else overflow=true;
  }
  prefs.end();
  if (configured) Serial.printf("Cloud station %s, RX%d TX%d @ %lu\n",cloudStation.id,cloudStation.rx,cloudStation.tx,cloudStation.baud);
  return configured;
}

void closeModem() {
  if (PPP.handle() && PPP.mode() != ESP_MODEM_MODE_COMMAND) PPP.mode(ESP_MODEM_MODE_COMMAND);
  PPP.end();
}
bool connectModem() {
  closeModem();
  PPP.setApn(cloudStation.apn);
  if (SIM_PIN) PPP.setPin(SIM_PIN);
  if (!PPP.setPins(cloudStation.tx,cloudStation.rx) || !PPP.begin(PPP_MODEM_SIM7600,2,cloudStation.baud)) return false;
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
class AckBuffer : public Stream {
public:
  String text;
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
  size_t write(uint8_t byte) override {
    if (text.length()>=512) return 0;
    return text.concat(char(byte)) ? 1 : 0;
  }
};

bool post(const String& body,const String& id,int& status,bool batch) {
  status=-1;
  NetworkClientSecure tls;
  tls.setCACert(ROOT_CA);
  tls.setHandshakeTimeout(12);
  HTTPClient https;
  https.setConnectTimeout(10000);
  https.setTimeout(12000);
  if (!https.begin(tls,INGEST_URL)) return false;
  https.addHeader("Content-Type","application/json");
  https.addHeader("Authorization",String("Bearer ")+cloudStation.token);
  https.addHeader("X-Device-Id",cloudStation.id);
  status = https.POST(body);
  bool confirmed=false;
  if ((status==200 || status==201) && https.getSize()<=512) {
    AckBuffer reply;
    if (https.writeToStream(&reply)>0) {
      reply.text.trim();
      // Match the paired server response exactly; ignore HTML or unrelated 200s.
      const String expected=batch ? String("{\"ok\":true,\"accepted\":[")+id+"]}" : String("{\"ok\":true,\"duplicate\":")+(status==200?"true":"false")+
        ",\"sample_id\":\""+id+"\"}";
      confirmed=reply.text==expected;
    }
  }
  https.end();
  return confirmed;
}
bool sendNext() {
  if (!SD_PINS_VERIFIED) {
    xSemaphoreTake(queueMutex,portMAX_DELAY);
    const String body=ramQueue.empty() ? String() : ramQueue.front();
    xSemaphoreGive(queueMutex);
    if (body.isEmpty()) return false;
    const String id=payloadId(body);
    if (id.isEmpty()) return false;
    int status;
    const bool confirmed=post(body,id,status,false);
    Serial.printf("RAM upload: HTTP %d | %s\n",status,confirmed?"ACK verified":"no ACK");
    if (confirmed || status==400 || status==409 || status==413 || status==422) {
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
  const String id=payloadId(body);
  const bool validName=!id.isEmpty() && path==String(samplePrefix)+id+".json";
  int status=422;
  const bool accepted=sizeOk && validName && post(body,id,status,false);
  const bool invalid=status==400 || status==409 || status==413 || status==422;
  if (!accepted && !invalid) {
    Serial.printf("SD kept %s | HTTP %d | no valid ACK\n",path.c_str(),status);
    return false;
  }
  xSemaphoreTake(queueMutex,portMAX_DELAY);
  const bool committed = accepted ? SD.remove(path) : SD.rename(path,String(rejectedDir)+"/"+path.substring(strlen(samplePrefix)));
  if (committed) --pendingCount;
  const auto queued=pendingCount;
  xSemaphoreGive(queueMutex);
  Serial.printf("SD %s | HTTP %d | %s | pending=%u\n",path.c_str(),status,
    committed?(accepted?"ACK verified, deleted":"retained in /rejected"):"SD update failed",
    static_cast<unsigned>(queued));
  return committed;
}
// Send a group when SD has backlog. A definitive bad batch falls back to
// single sends so a damaged record cannot hold up other measurements.
enum BatchResult { Single, Done, Deferred };

int sendSdBatch() {
  constexpr unsigned capacity=12;
  String paths[capacity];
  String ids;
  String request="{\"samples\":[";
  unsigned size=0;
  xSemaphoreTake(queueMutex,portMAX_DELAY);
  if (pendingCount>=2) {
    File folder=SD.open(queueDir);
    if (folder && folder.isDirectory()) {
      for(File file=folder.openNextFile(); file && size<capacity; file=folder.openNextFile()) {
        if(file.isDirectory()) continue;
        const String path=file.path();
        if(!path.startsWith(samplePrefix) || !path.endsWith(".json")) continue;
        if(!file.size() || file.size()>4096) break;
        const String body=file.readString();
        const String id=payloadId(body);
        if(id.isEmpty() || path!=String(samplePrefix)+id+".json" || request.length()+body.length()>14000) break;
        if(size && (!request.concat(',') || !ids.concat(','))) {size=0;break;}
        if(!request.concat(body) || !ids.concat("\"") || !ids.concat(id) || !ids.concat("\"")) {size=0;break;}
        paths[size++]=path;
      }
    }
  }
  xSemaphoreGive(queueMutex);
  if (size<2 || !request.concat("]}")) return BatchResult::Single;
  int status;
  if(!post(request,ids,status,true)) {
    if(status==400 || status==409 || status==413 || status==422) return BatchResult::Single;
    Serial.printf("SD batch kept | HTTP %d | no valid ACK\n",status);
    return BatchResult::Deferred;
  }
  unsigned deleted=0;
  xSemaphoreTake(queueMutex,portMAX_DELAY);
  for(unsigned i=0;i<size;++i) if(SD.remove(paths[i])) {--pendingCount;++deleted;}
  const auto queued=pendingCount;
  xSemaphoreGive(queueMutex);
  Serial.printf("ACK verified, deleted %u/%u SD sample(s) | pending=%u\n",deleted,size,static_cast<unsigned>(queued));
  return deleted==size ? BatchResult::Done : BatchResult::Deferred;
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
    unsigned completed=0;
    if (time(nullptr)>=earliestClock) {
      for (;completed<12 && PPP.hasIP();++completed) {
        if (SD_PINS_VERIFIED) {
          const auto result=sendSdBatch();
          if (result==BatchResult::Deferred) break;
          if (result==BatchResult::Done) {delay(80);continue;}
        }
        if (!sendNext()) break;
        delay(35);
      }
    } else Serial.println("Waiting for UTC from GPS/RTC/SNTP before TLS");
    delay(SD_PINS_VERIFIED && completed==12 ? 200 : SEND_MS);
  }
}
void setup() {
  Serial.begin(115200);
#if SALINITY_ADC_PIN == 4
  analogReadResolution(12);
  analogSetPinAttenuation(SALINITY_ADC_PIN,ADC_11db);
#endif
  setenv("TZ","UTC0",1);
  tzset();
#if ENABLE_DS1307
  initializeRtc();
#endif
  esp_fill_random(bootId,sizeof bootId);
  Serial1.setRxBufferSize(1024);
  Serial1.begin(GPS_BAUD,SERIAL_8N1,GPS_RX,-1);
  queueMutex=xSemaphoreCreateMutex();
  if (!queueMutex) { Serial.println("Cannot allocate queue mutex"); return; }
  sdReady=initializeStorage();
  if (!SD_PINS_VERIFIED) Serial.println("RAM queue enabled (60 samples); enable verified SD for power-loss persistence.");
  else if (!sdReady) Serial.println("SD not ready; samples cannot be queued.");
#if ENABLE_DS18B20
  if (TEMP_PIN>=0) {
    oneWire.begin(TEMP_PIN);
    thermometer.begin();
    thermometer.setWaitForConversion(false);
  }
#endif
  if (PROBE_RX>=0 && PROBE_TX>=0) {
    if (PROBE_DE>=0) { pinMode(PROBE_DE,OUTPUT); digitalWrite(PROBE_DE,LOW); }
    Serial0.begin(PROBE_BAUD,PROBE_SERIAL_MODE,PROBE_RX,PROBE_TX);
  }
  if (loadCloudStation() && strstr(ROOT_CA,"-----BEGIN CERTIFICATE-----")) {
    if (xTaskCreate(networkTask,"lte",12288,nullptr,1,nullptr)!=pdPASS) Serial.println("Could not start LTE task");
  } else Serial.println("LTE disabled: check wiring verification, APN, endpoint, device token and CA.");
}
void loop() {
  if (!queueMutex) { delay(1000); return; }
  readGps();
  synchronizeGpsClock();
  const auto now=millis();
#if ENABLE_DS18B20
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
#else
  if (static_cast<int32_t>(now-nextSample)>=0) {
    nextSample=now+SAMPLE_MS;
    recordSample(NAN);
  }
#endif
  delay(3);
}
