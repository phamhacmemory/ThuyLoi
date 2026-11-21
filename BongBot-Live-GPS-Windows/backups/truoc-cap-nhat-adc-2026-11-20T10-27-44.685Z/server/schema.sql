PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS readings (
  device_id TEXT NOT NULL,
  sample_id TEXT NOT NULL,
  measured_at INTEGER,
  received_at INTEGER NOT NULL,
  observed_at INTEGER GENERATED ALWAYS AS (coalesce(measured_at, received_at)) STORED,
  lat REAL, lng REAL, hdop REAL, satellites INTEGER,
  ec_us_cm REAL, temp_c REAL, salinity_psu REAL,
  battery_v REAL, dropped INTEGER,
  payload TEXT NOT NULL,
  PRIMARY KEY (device_id, sample_id)
) STRICT;
CREATE INDEX IF NOT EXISTS readings_by_device_time
  ON readings(device_id, observed_at DESC, received_at DESC);
CREATE INDEX IF NOT EXISTS readings_by_device_receive
  ON readings(device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS readings_by_device_fix
  ON readings(device_id, measured_at DESC, received_at DESC) WHERE lat IS NOT NULL;
