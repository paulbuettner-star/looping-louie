-- Play records: one anonymous row per game and device (see stats() in src/index.js). No names, no IP addresses.
CREATE TABLE games (
  id TEXT PRIMARY KEY,           -- random, made by the relay; the page only uses it to add the end and the rating
  created TEXT NOT NULL,         -- when the game started (UTC, relay clock)
  v TEXT,                        -- game version, e.g. v12
  mode TEXT,                     -- normal | aquigai
  place TEXT,                    -- local (one device) | host | guest (online)
  seq INTEGER,                   -- the how-many-th game on this page since it was opened (1 = first)
  prev TEXT,                     -- the mode of the game before it on this page: normal | aquigai (null for the first)
  tbl TEXT,                      -- online table code, so the host's and guests' rows of one game can be matched
  speed TEXT,                    -- chill | normal | wild
  humans INTEGER,                -- players on this device
  remotes INTEGER,               -- players on other devices
  cpus INTEGER,
  levels TEXT,                   -- the CPUs' levels, e.g. easy,hard
  touch INTEGER,                 -- 1: touch screen
  lang TEXT,                     -- browser language, two letters
  screen TEXT,                   -- phone | tablet | desktop
  ended TEXT,                    -- won | left | closed (null: never heard back)
  ended_at TEXT,
  result TEXT,                   -- who won, from this device: you | other | cpu | louie
  game_s REAL,                   -- seconds of play (game clock)
  real_s REAL,                   -- seconds on the clock, replays and pauses included
  knockouts INTEGER,             -- farmers out by the end
  replays INTEGER,               -- instant replays shown
  skips INTEGER,                 -- replays skipped with a lever press
  mushrooms INTEGER, hearts INTEGER, hats INTEGER, lotus INTEGER,   -- magic items collected (Aquigai mode)
  missed TEXT,                   -- the item still flying, never collected, when the game ended: mushroom | heart | hat | lotus
  missed_s REAL,                 -- how long it had been flying by then
  stars INTEGER,                 -- 1-5, optional
  feedback TEXT,                 -- ideas or improvements, optional, up to 500 characters
  rated_at TEXT
);
CREATE INDEX games_created ON games (created);
