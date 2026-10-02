import app from "./app.ts";
import chats from "./chats.ts";
import connect from "./connect.ts";
import heart from "./heart.ts";
import life from "./life.ts";
import memory from "./memory.ts";
import nature from "./nature.ts";
import now from "./now.ts";
import people from "./people.ts";
import system from "./system.ts";
import time from "./time.ts";

// One table, keyed by the Chinese text. It is split by section only to keep
// each file readable; the tests make sure no wording is missing or left over.
const english: Record<string, string> = {
  ...app,
  ...chats,
  ...connect,
  ...heart,
  ...life,
  ...memory,
  ...nature,
  ...now,
  ...people,
  ...system,
  ...time,
};

export default english;
